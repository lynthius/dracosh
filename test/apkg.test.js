import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readApkg, toApkg } from "../src/apkg.js";
import { addCard, createDeck, emptyLibrary, setDirections } from "../src/library.js";
import { loadSqlite } from "../src/sqlite.js";
import { readZip, writeZip } from "../src/zip.js";

const scratch = () => mkdtempSync(join(tmpdir(), "dracosh-apkg-test-"));

// the package's collection, opened read-only: { ver, models, decks, notes, cards }
async function open(buffer) {
  const folder = scratch();
  try {
    const file = join(folder, "deck.apkg");
    writeFileSync(file, buffer);
    const files = await readZip(file, ["collection.anki2", "media", "anything else"]);
    assert.deepEqual([...files.keys()], ["collection.anki2", "media"]);
    assert.equal(files.get("media").toString(), "{}");
    const path = join(folder, "collection.anki2");
    writeFileSync(path, files.get("collection.anki2"));
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path, { readOnly: true });
    const col = db.prepare("SELECT ver, models, decks FROM col").get();
    const result = {
      ver: col.ver,
      models: JSON.parse(col.models),
      decks: JSON.parse(col.decks),
      notes: db.prepare("SELECT id, guid, mid, mod, tags, flds, sfld, csum FROM notes ORDER BY id").all(),
      cards: db.prepare("SELECT nid, did, ord, due, type, queue FROM cards ORDER BY id").all()
    };
    db.close();
    return result;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const sample = () => {
  const library = emptyLibrary();
  const both = createDeck(library, { name: "Spanish", directions: "both" });
  const one = createDeck(library, { name: "Terms", directions: "backward" });
  addCard(library, both.id, { front: "el gato", back: ["the cat", "a; b"], example: "Mi <gato> & yo.", tags: ["animals", "two words"] });
  addCard(library, both.id, { front: "Ella {{come}} y {{bebe}}.", back: ["verbs"], example: "She eats.", cloze: true });
  addCard(library, both.id, { front: "I \\{{kept}} {{this}}", back: [], cloze: true });
  addCard(library, one.id, { front: "ion", back: ["a charged atom"] });
  return { library, decks: [both, one] };
};

test("an .apkg is a zip with a schema 11 collection, the decks and Dracosh's own two note types", async () => {
  const { library, decks } = sample();
  const anki = await open(await toApkg(library, decks, { now: 1_760_000_000_000 }));
  assert.equal(anki.ver, 11);
  assert.deepEqual(Object.values(anki.models).map((model) => [model.name, model.type, model.flds.map((f) => f.name)]), [
    ["Dracosh", 0, ["Front", "Back", "Example", "Forward", "Backward"]],
    ["Dracosh Cloze", 1, ["Text", "Hint", "Example"]]
  ]);
  assert.deepEqual(Object.values(anki.decks).map((deck) => deck.name).sort(), ["Default", "Spanish", "Terms"]);
});

test("fields are HTML, a card is made for each way its deck asks, and each gap is a cloze card", async () => {
  const { library, decks } = sample();
  const { notes, cards, decks: ankiDecks } = await open(await toApkg(library, decks));
  const fields = notes.map((note) => note.flds.split("\x1f"));
  assert.deepEqual(fields, [
    ["el gato", "the cat<br>a; b", "Mi &lt;gato&gt; &amp; yo.", "y", "y"],
    ["Ella {{c1::come}} y {{c2::bebe}}.", "verbs", "She eats."],
    ["I &#123;{kept}} {{c1::this}}", "", ""],
    ["ion", "a charged atom", "", "", "y"]
  ]);
  const deckName = (did) => ankiDecks[did].name;
  assert.deepEqual(cards.map((card) => [notes.findIndex((note) => note.id === card.nid), deckName(card.did), card.ord]), [
    [0, "Spanish", 0],
    [0, "Spanish", 1],
    [1, "Spanish", 0],
    [1, "Spanish", 1],
    [2, "Spanish", 0],
    [3, "Terms", 1]
  ]);
  assert.ok(cards.every((card) => card.type === 0 && card.queue === 0), "every card arrives as new");
  assert.equal(notes[0].tags, " animals two_words ");
  assert.equal(notes[0].sfld, "el gato");
});

test("a second export has the same guids, note type ids and deck ids, so Anki updates instead of adding", async () => {
  const { library, decks } = sample();
  const first = await open(await toApkg(library, decks, { now: 1_760_000_000_000 }));
  const second = await open(await toApkg(library, decks, { now: 1_770_000_000_000 }));
  assert.deepEqual(second.notes.map((note) => note.guid), first.notes.map((note) => note.guid));
  assert.deepEqual(Object.keys(second.models), Object.keys(first.models));
  assert.deepEqual(Object.keys(second.decks), Object.keys(first.decks));
  assert.deepEqual(Object.values(second.models).map((model) => model.mod), Object.values(first.models).map((model) => model.mod), "the note types look unchanged to Anki");
  assert.equal(new Set(first.notes.map((note) => note.guid)).size, first.notes.length);
});

test("writeZip and readZip: names in UTF-8, only the files asked for, any content back as it was", async () => {
  const entries = [
    { name: "a.txt", data: Buffer.from("hello ".repeat(1000)) },
    { name: "źdźbło/ü.bin", data: Buffer.from([0, 1, 2, 255]) },
    { name: "empty", data: Buffer.alloc(0) }
  ];
  const folder = scratch();
  const file = join(folder, "test.zip");
  writeFileSync(file, writeZip(entries));
  const files = await readZip(file, ["źdźbło/ü.bin", "a.txt", "empty", "missing"]);
  assert.deepEqual([...files].map(([name, data]) => [name, [...data]]).sort(), entries.map(({ name, data }) => [name, [...data]]).sort());
  assert.deepEqual([...(await readZip(file, ["empty"])).keys()], ["empty"]);
  writeFileSync(file, "not a zip");
  await assert.rejects(readZip(file, ["a.txt"]), { code: "NOT_ZIP" });
  rmSync(folder, { recursive: true, force: true });
});

const read = async (buffer) => {
  const folder = scratch();
  const file = join(folder, "deck.apkg");
  writeFileSync(file, buffer);
  try {
    return await readApkg(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};
const shown = (list) => list.items.map(({ deck, direction, skip, fields }) => [deck, direction, skip ?? null, fields.front, fields.back, fields.example, fields.cloze]);

test("an .apkg from Dracosh reads back as the same cards, with how each deck asks", async () => {
  const { library, decks } = sample();
  assert.deepEqual(shown(await read(await toApkg(library, decks))), [
    ["Spanish", "both", null, "el gato", ["the cat", "a; b"], "Mi <gato> & yo.", false],
    ["Spanish", "both", null, "Ella {{come}} y {{bebe}}.", ["verbs"], "She eats.", true],
    ["Spanish", "both", null, "I \\{{kept}} {{this}}", [], "", true],
    ["Terms", "backward", null, "ion", ["a charged atom"], "", false]
  ]);
});

// made by Anki itself: test/fixtures/make-anki-fixtures.py
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const FROM_ANKI = [
  ["Spanish", "forward", null, "el gato", ["the cat, the kitty"], "Mi gato duerme.", false],
  ["Spanish::Both ways", "both", null, "la casa", ["the house"], "", false],
  ["Spanish::Both ways", "both", null, "la mesa", ["the table"], "", false],
  ["Spanish", "forward", null, "Ella {{come}} {{pan}}.", ["verb"], "She eats bread.", true],
  ["Spanish", "forward", null, "el perro", ["the dog"], "El perro ladra.", false],
  ["Spanish", "forward", null, "El {{sol}} quema.", [], "It's summer.", true],
  ["Spanish", "forward", null, "猫", ["cat"], "", false],
  ["Spanish", "forward", null, "Un {{gato negro grande}}.", [], "", true],
  ["Spanish", "forward", null, "café …", ["coffee — strong"], "", false],
  ["Spanish", "forward", "mediaOnly", "", ["el perro"], "", false],
  ["Spanish", "forward", "picture", "", [], "", false],
  ["Spanish", "forward", null, "el pájaro", ["the bird"], "", false]
];

test("Anki's package of today (zstd, schema 18): every kind of note, by its note type's kind", async () => {
  const list = await readApkg(join(FIXTURES, "anki-modern.apkg"));
  assert.deepEqual(shown(list), FROM_ANKI, "a card in a filtered deck goes to the deck it came from");
  assert.equal(list.media, 1, "the picture cards are left out, not counted here");
  assert.deepEqual(list.items[6].fields.tags, ["animals", "core::n5"]);
});

test("Anki's older package (schema 11) reads the same", async () => {
  const list = await readApkg(join(FIXTURES, "anki-legacy.apkg"));
  // exported without scheduling, Anki itself turned the filtered deck into a plain one
  assert.deepEqual(shown(list), FROM_ANKI.map((row, i) => (i === FROM_ANKI.length - 1 ? ["Review", ...row.slice(1)] : row)));
});

test("a file that isn't an Anki package is said so, whatever its name", async () => {
  await assert.rejects(read(Buffer.from("el gato = the cat")), { code: "NOT_ANKI" });
  await assert.rejects(read(writeZip([{ name: "photo.jpg", data: Buffer.from([1, 2, 3]) }])), { code: "NOT_ANKI" });
  await assert.rejects(read(writeZip([{ name: "collection.anki2", data: Buffer.from("not a database") }])), { code: "NOT_ANKI" });
  await assert.rejects(read(writeZip([{ name: "collection.anki21b", data: Buffer.from("not zstd") }])), { code: "NOT_ANKI" });
});

test("braces in a card without gaps, \"::\" in a gap and braces kept as text come back as they were", async () => {
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Code" });
  addCard(library, deck.id, { front: "What does {{ product.title }} print?", back: ["the title"] });
  addCard(library, deck.id, { front: "Time {{12::30}} and \\{{c1::lit}} kept", back: [], cloze: true });
  const { notes } = await open(await toApkg(library, [deck]));
  assert.equal(notes[1].flds.split("\x1f")[0], "Time {{c1::12:&#58;30}} and &#123;{c1::lit}} kept", "nothing Anki would read as another gap or a hint");
  assert.deepEqual(shown(await read(await toApkg(library, [deck]))), [
    ["Code", "both", null, "What does {{ product.title }} print?", ["the title"], "", false],
    ["Code", "both", null, "Time {{12::30}} and \\{{c1::lit}} kept", [], "", true]
  ]);
});

test("a deck asked another way makes its notes newer, so Anki updates them instead of leaving blank cards", async () => {
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Spanish", directions: "forward", now: 1_000_000_000_000 });
  addCard(library, deck.id, { front: "uno", back: ["one"], now: 1_000_000_000_000 });
  const before = (await open(await toApkg(library, [deck]))).notes[0];
  setDirections(library, deck.id, "both", 1_000_100_000_000);
  const after = await open(await toApkg(library, [deck]));
  assert.ok(after.notes[0].mod > before.mod);
  assert.deepEqual(after.notes[0].flds.split("\x1f").slice(3), ["y", "y"]);
});

test("a Dracosh deck called Default is Anki's Default deck, not a second one of that name", async () => {
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Default" });
  addCard(library, deck.id, { front: "uno", back: ["one"] });
  const { decks, cards } = await open(await toApkg(library, [deck]));
  assert.deepEqual(Object.keys(decks), ["1"]);
  assert.equal(cards[0].did, 1);
});

// a zip64 end record in front of the plain one, as Anki writes past 65 535 files or 4 GB
function asZip64(zip) {
  const endAt = zip.length - 22;
  const [count, size, at] = [zip.readUInt16LE(endAt + 10), zip.readUInt32LE(endAt + 12), zip.readUInt32LE(endAt + 16)];
  const end64 = Buffer.alloc(56);
  end64.writeUInt32LE(0x06064b50, 0);
  end64.writeBigUInt64LE(44n, 4);
  end64.writeUInt16LE(45, 12);
  end64.writeUInt16LE(45, 14);
  end64.writeBigUInt64LE(BigInt(count), 24);
  end64.writeBigUInt64LE(BigInt(count), 32);
  end64.writeBigUInt64LE(BigInt(size), 40);
  end64.writeBigUInt64LE(BigInt(at), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(endAt), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.from(zip.subarray(endAt));
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([zip.subarray(0, endAt), end64, locator, end]);
}

test("readZip reads zip64, and says a cut or broken zip is damaged instead of reading past it", async () => {
  const folder = scratch();
  const file = join(folder, "test.zip");
  const zip = writeZip([{ name: "a", data: Buffer.from("hello") }, { name: "b", data: Buffer.from("world") }]);
  writeFileSync(file, asZip64(zip));
  assert.equal((await readZip(file, ["b"])).get("b").toString(), "world");
  assert.deepEqual([...(await readZip(file, ["b", "a"], { first: true })).keys()], ["b"], "only the first one there");
  writeFileSync(file, zip.subarray(30));
  await assert.rejects(readZip(file, ["a"]), { code: "DAMAGED_ZIP" });
  const pointsOut = Buffer.from(zip);
  pointsOut.writeUInt32LE(zip.length * 2, zip.length - 6);
  writeFileSync(file, pointsOut);
  await assert.rejects(readZip(file, ["a"]), { code: "DAMAGED_ZIP" });
  rmSync(folder, { recursive: true, force: true });
});

test("a cut Anki package is said not to be one, never a raw error", async () => {
  const whole = readFileSync(join(FIXTURES, "anki-modern.apkg"));
  await assert.rejects(read(whole.subarray(whole.length - 30000)), { code: "NOT_ANKI" });
  await assert.rejects(read(whole.subarray(0, whole.length - 100)), { code: "NOT_ANKI" });
});

test("a Dracosh note keeps its guid on another computer; Anki's own notes are marked, never sent back under theirs", async () => {
  const { library, decks } = sample();
  const first = await open(await toApkg(library, decks));
  // read on another computer: new card ids, the same notes in Anki
  const elsewhere = emptyLibrary();
  const list = await read(await toApkg(library, decks));
  for (const name of new Set(list.items.map((item) => item.deck))) {
    const deck = createDeck(elsewhere, { name });
    for (const item of list.items.filter((each) => each.deck === name)) addCard(elsewhere, deck.id, item.fields);
  }
  const again = await open(await toApkg(elsewhere, elsewhere.decks));
  assert.deepEqual(again.notes.map((note) => note.guid).sort(), first.notes.map((note) => note.guid).sort());
  const fromAnki = await readApkg(join(FIXTURES, "anki-modern.apkg"));
  assert.ok(fromAnki.items.filter((item) => !item.skip).every((item) => item.fields.fromAnki && !item.fields.guid));
});
