import { open } from "node:fs/promises";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// A zip file (PKWARE APPNOTE 6.3), the container of an Anki package: each file deflated, names in
// UTF-8, no zip64 (an export never comes near 4 GB).
//   writeZip([{ name: "media", data: Buffer }], { date }) → Buffer

const dosTime = (date) => (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
const dosDate = (date) => ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20; // 2.0: deflate

export function writeZip(entries, { date = new Date() } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    if (packed.length > 0xffffffff || data.length > 0xffffffff || offset > 0xffffffff) throw new Error("Too big for a zip without zip64");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(dosTime(date), 10);
    local.writeUInt16LE(dosDate(date), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(dosTime(date), 12);
    central.writeUInt16LE(dosDate(date), 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra field, comment, disk number, internal and external attributes: all zero
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const STORED = 0;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const damaged = (why) => Object.assign(new Error(`Damaged zip file: ${why}`), { code: "DAMAGED_ZIP" });

// readZip(file, names, { first }) → Map of name → Buffer, for just the files asked for (an Anki
// package can hold gigabytes of media next to the collection); `first`: only the first of `names`
// there is. Stored or deflated files, zip64 too (what Anki writes past 4 GB).
export async function readZip(file, names, { first = false } = {}) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const read = async (position, length) => {
      if (position < 0 || length < 0 || position + length > size) throw damaged("a part points outside the file");
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead < length) throw damaged("the file ends early");
      return buffer;
    };
    // the end record is in the last 22 bytes, or before a comment of up to 64 KB
    const tailStart = Math.max(0, size - 22 - 0xffff);
    const tail = await read(tailStart, size - tailStart);
    let endAt = -1;
    for (let i = tail.length - 22; i >= 0 && endAt < 0; i--) if (tail.readUInt32LE(i) === END) endAt = i;
    if (endAt < 0) throw Object.assign(new Error("Not a zip file"), { code: "NOT_ZIP" });
    let count = tail.readUInt16LE(endAt + 10);
    let directorySize = tail.readUInt32LE(endAt + 12);
    let directoryAt = tail.readUInt32LE(endAt + 16);
    // zip64: the real numbers are in a record of their own, which a locator just before this one finds
    if (count === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff) {
      const locator = endAt - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== END64_LOCATOR) throw damaged("no zip64 end record");
      const end64 = await read(Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (end64.readUInt32LE(0) !== END64) throw damaged("no zip64 end record");
      count = Number(end64.readBigUInt64LE(32));
      directorySize = Number(end64.readBigUInt64LE(40));
      directoryAt = Number(end64.readBigUInt64LE(48));
    }
    const directory = await read(directoryAt, directorySize);
    const found = new Map();
    for (let at = 0, i = 0; i < count; i++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL) throw damaged("a broken directory");
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const next = at + 46 + nameLength + extraLength + directory.readUInt16LE(at + 32);
      if (next > directory.length) throw damaged("a broken directory");
      const name = directory.toString("utf8", at + 46, at + 46 + nameLength);
      if (names.includes(name)) {
        const entry = { method: directory.readUInt16LE(at + 10), packed: directory.readUInt32LE(at + 20), size: directory.readUInt32LE(at + 24), local: directory.readUInt32LE(at + 42) };
        // zip64 sizes and offset, in that order, only for the ones that didn't fit
        let extra = at + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
          const [id, length] = [directory.readUInt16LE(extra), directory.readUInt16LE(extra + 2)];
          if (id === ZIP64_EXTRA) {
            let field = extra + 4;
            for (const key of ["size", "packed", "local"]) {
              if (entry[key] !== 0xffffffff) continue;
              if (field + 8 > extra + 4 + length) throw damaged("a broken zip64 field");
              entry[key] = Number(directory.readBigUInt64LE(field));
              field += 8;
            }
          }
          extra += 4 + length;
        }
        found.set(name, entry);
      }
      at = next;
    }
    const wanted = first ? names.filter((name) => found.has(name)).slice(0, 1) : names.filter((name) => found.has(name));
    const files = new Map();
    for (const name of wanted) {
      const { method, packed: packedSize, size: unpackedSize, local } = found.get(name);
      const header = await read(local, 30);
      if (header.readUInt32LE(0) !== LOCAL) throw damaged(`no header for ${name}`);
      const packed = await read(local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), packedSize);
      if (method === STORED) files.set(name, packed);
      else if (method === DEFLATE) {
        const data = inflateRawSync(packed);
        if (data.length !== unpackedSize) throw damaged(`${name} unpacks to the wrong size`);
        files.set(name, data);
      } else throw damaged(`unsupported compression in ${name}`);
    }
    return files;
  } finally {
    await handle.close();
  }
}
