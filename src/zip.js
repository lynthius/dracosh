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
const CENTRAL = 0x02014b50;

// readZip(file, names) → Map of name → Buffer, for just the files asked for (an Anki package can hold
// gigabytes of media next to the collection). Stored or deflated files, as Anki writes them.
export async function readZip(file, names) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    };
    // the end record is in the last 22 bytes, or before a comment of up to 64 KB
    const tailStart = Math.max(0, size - 22 - 0xffff);
    const tail = await read(tailStart, size - tailStart);
    let endAt = -1;
    for (let i = tail.length - 22; i >= 0 && endAt < 0; i--) if (tail.readUInt32LE(i) === END) endAt = i;
    if (endAt < 0) throw Object.assign(new Error("Not a zip file"), { code: "NOT_ZIP" });
    const count = tail.readUInt16LE(endAt + 10);
    const directorySize = tail.readUInt32LE(endAt + 12);
    const directoryAt = tail.readUInt32LE(endAt + 16);
    if (directoryAt === 0xffffffff || count === 0xffff) throw Object.assign(new Error("A zip64 file"), { code: "ZIP64" });
    const directory = await read(directoryAt, directorySize);
    const found = new Map();
    for (let at = 0, i = 0; i < count; i++) {
      if (directory.readUInt32LE(at) !== CENTRAL) throw Object.assign(new Error("Damaged zip file"), { code: "DAMAGED_ZIP" });
      const nameLength = directory.readUInt16LE(at + 28);
      const name = directory.toString("utf8", at + 46, at + 46 + nameLength);
      if (names.includes(name)) found.set(name, { method: directory.readUInt16LE(at + 10), size: directory.readUInt32LE(at + 20), local: directory.readUInt32LE(at + 42) });
      at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    }
    const files = new Map();
    for (const [name, { method, size: packedSize, local }] of found) {
      const header = await read(local, 30);
      const packed = await read(local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), packedSize);
      if (method === STORED) files.set(name, packed);
      else if (method === DEFLATE) files.set(name, inflateRawSync(packed));
      else throw Object.assign(new Error(`Unsupported compression in ${name}`), { code: "DAMAGED_ZIP" });
    }
    return files;
  } finally {
    await handle.close();
  }
}
