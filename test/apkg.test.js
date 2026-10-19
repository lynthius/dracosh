import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { toApkg } from "../src/apkg.js";
import { addCard, createDeck, emptyLibrary } from "../src/library.js";
import { loadSqlite } from "../src/sqlite.js";
import { readZip, writeZip } from "../src/zip.js";

// the package's collection, opened read-only: { notes, cards, models, decks }
async function open(buffer) {
  const files = readZip(buffer);
  assert.deepEqual([...files.keys()], ["collection.anki2", "media"]);
  assert.equal(files.get("media").toString(), "{}");
  const folder = mkdtempSync(join(tmpdir(), "dracosh-apkg-test-"));
  try {
    const path = join(folder, "collection.anki2");
    writeFileSync(path, files.get("collection.anki2"));
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path, { readOnly: true });
    const col = db.prepare("SELECT ver, models, decks FROM col").get();
    const result = {
      ver: col.ver,
      models: JSON.parse(col.models),
      decks: JSON.parse(col.decks),
      notes: db.prepare("SELECT id, guid, mid, tags, flds, sfld, csum FROM notes ORDER BY id").all(),
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
    ["el gato", "the cat; a\\; b", "Mi &lt;gato&gt; &amp; yo.", "y", "y"],
    ["Ella {{c1::come}} y {{c2::bebe}}.", "verbs", "She eats."],
    ["I {{kept}} {{c1::this}}", "", ""],
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

test("writeZip and readZip: names in UTF-8, any content back as it was", () => {
  const entries = [
    { name: "a.txt", data: Buffer.from("hello ".repeat(1000)) },
    { name: "źdźbło/ü.bin", data: Buffer.from([0, 1, 2, 255]) },
    { name: "empty", data: Buffer.alloc(0) }
  ];
  const files = readZip(writeZip(entries));
  assert.deepEqual([...files].map(([name, data]) => [name, [...data]]), entries.map(({ name, data }) => [name, [...data]]));
  assert.throws(() => readZip(Buffer.from("not a zip")), /Not a zip/);
});
