import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { columnsFrom, htmlLines, noteFields } from "./cardlist.js";
import { GAP } from "./cardline.js";
import { escapeHtml, joinAnswers } from "./exporter.js";
import { cardsOf } from "./library.js";
import { loadSqlite, unzstd } from "./sqlite.js";
import { readZip, writeZip } from "./zip.js";

// An Anki deck package (.apkg): a zip with the collection as an SQLite file, in the schema Anki
// writes with "Support older Anki versions" (schema 11, as genanki writes it), so every Anki
// since 2.1 opens it, and AnkiDroid and AnkiMobile too.
//
// The package brings its own two note types, so it opens the same in an Anki set up in any language
// (a text file can only name a note type, and Anki names its own in its language):
//   Dracosh        Front, Back, Example, Forward, Backward: a card is made for each way the deck
//                  asks ("y" in Forward and/or Backward), as Anki's own "optional reversed card" does
//   Dracosh Cloze  Text ({{c1::…}} for each gap), Hint (shown with the gap), Example
// Their ids are fixed and they only change with NOTE_TYPES_VERSION, so a second export reuses the
// note types already in Anki. Each note's guid comes from the card's id, so it updates the notes
// already there instead of adding them again. Progress isn't written: the cards arrive as new.

const BASIC_ID = 1760358162311;
const CLOZE_ID = 1760358162312;
const NOTE_TYPES_VERSION = 1760358162; // a template or field changed → a new timestamp here
const DEFAULT_DECK = 1;

const CSS = `.card {
    font-family: arial;
    font-size: 20px;
    line-height: 1.5;
    text-align: center;
    color: black;
    background-color: white;
}
.example, .hint {
    margin-top: 0.8em;
    font-size: 0.8em;
    color: #555;
}
.example { font-style: italic; }
.nightMode .example, .nightMode .hint { color: #aaa; }
.cloze { font-weight: bold; color: blue; }
.nightMode .cloze { color: lightblue; }
`;

const EXAMPLE = '{{#Example}}<div class="example">{{Example}}</div>{{/Example}}';
const HINT = '{{#Hint}}<div class="hint">{{Hint}}</div>{{/Hint}}';
const ANSWER = "\n\n<hr id=answer>\n\n";

const field = (name, ord, description = "") => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, description, plainText: false, collapsed: false, excludeFromSearch: false });
const template = (name, ord, qfmt, afmt) => ({ name, ord, qfmt, afmt, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 });
const noteType = (fields) => ({ mod: NOTE_TYPES_VERSION, usn: -1, sortf: 0, did: null, tags: [], vers: [], css: CSS, latexPre: LATEX_PRE, latexPost: "\\end{document}", latexsvg: false, ...fields });
const LATEX_PRE = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

const NOTE_TYPES = {
  [BASIC_ID]: noteType({
    id: BASIC_ID,
    name: "Dracosh",
    type: 0,
    flds: [field("Front", 0), field("Back", 1), field("Example", 2), field("Forward", 3, "y: ask front → back"), field("Backward", 4, "y: ask back → front")],
    tmpls: [
      template("Forward", 0, "{{#Forward}}{{Front}}{{/Forward}}", `{{FrontSide}}${ANSWER}{{Back}}${EXAMPLE}`),
      template("Backward", 1, "{{#Backward}}{{Back}}{{/Backward}}", `{{FrontSide}}${ANSWER}{{Front}}${EXAMPLE}`)
    ],
    req: [
      [0, "all", [0, 3]],
      [1, "all", [1, 4]]
    ]
  }),
  [CLOZE_ID]: noteType({
    id: CLOZE_ID,
    name: "Dracosh Cloze",
    type: 1,
    flds: [field("Text", 0), field("Hint", 1), field("Example", 2)],
    tmpls: [template("Cloze", 0, `{{cloze:Text}}${HINT}`, `{{cloze:Text}}${HINT}${EXAMPLE}`)],
    req: [[0, "any", [0]]]
  })
};

const deckEntry = (id, name, mod) => ({
  id,
  mod,
  name,
  usn: -1,
  lrnToday: [0, 0],
  revToday: [0, 0],
  newToday: [0, 0],
  timeToday: [0, 0],
  collapsed: false,
  browserCollapsed: false,
  desc: "",
  dyn: 0,
  conf: 1,
  extendNew: 0,
  extendRev: 0
});

const DECK_CONFIG = {
  1: {
    id: 1,
    mod: 0,
    name: "Default",
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
    rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 }
  }
};

const SCHEMA = `
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

const sha1 = (text) => createHash("sha1").update(text).digest();
// the same Dracosh card always gets the same guid; Anki matches notes by it
const guidOf = (cardId) => sha1(`dracosh card ${cardId}`).toString("base64url").slice(0, 10);
// a deck id that stays the same between exports (Anki's own are millisecond timestamps)
const deckIdOf = (deckId) => 1_000_000_000_000 + (sha1(`dracosh deck ${deckId}`).readUInt32BE(0) % 1_000_000_000) * 1000;
// Anki's sort field and checksum: the first field without HTML, its sha1's first 8 hex digits
const unhtml = (html) => html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const checksum = (html) => sha1(unhtml(html)).readUInt32BE(0);
const tagsOf = (tags = []) => (tags.length ? ` ${tags.map((tag) => tag.replace(/\s+/g, "_")).join(" ")} ` : "");

// a card → the note's fields and the templates to make cards from ("ord")
function noteOf(card, deck) {
  const example = card.example ? escapeHtml(card.example) : "";
  if (card.cloze) {
    let gap = 0;
    // braces kept as text ("\{{") are plain text in Anki too: only "{{c1::…}}" is a gap there
    const text = escapeHtml(card.front.replace(GAP, (_, inside) => `{{c${++gap}::${inside}}}`).replace(/\\\{\{/g, "{{"));
    return { mid: CLOZE_ID, fields: [text, escapeHtml(card.back.join("; ")), example], ords: [...Array(gap).keys()] };
  }
  const forward = deck.directions !== "backward";
  const backward = deck.directions !== "forward";
  const fields = [escapeHtml(card.front), escapeHtml(joinAnswers(card.back)), example, forward ? "y" : "", backward ? "y" : ""];
  return { mid: BASIC_ID, fields, ords: [...(forward ? [0] : []), ...(backward ? [1] : [])] };
}

// The decks' cards as an .apkg file → Buffer. SQLite is loaded only here, for this.
export async function toApkg(library, decks, { now = Date.now() } = {}) {
  const { DatabaseSync } = await loadSqlite();
  const folder = mkdtempSync(join(tmpdir(), "dracosh-apkg-"));
  try {
    const path = join(folder, "collection.anki2");
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    const seconds = Math.floor(now / 1000);
    const deckIds = new Map(decks.map((deck) => [deck.id, deckIdOf(deck.id)]));
    const ankiDecks = { [DEFAULT_DECK]: deckEntry(DEFAULT_DECK, "Default", seconds) };
    for (const deck of decks) ankiDecks[deckIds.get(deck.id)] = deckEntry(deckIds.get(deck.id), deck.name, seconds);
    const conf = { activeDecks: [DEFAULT_DECK], curDeck: DEFAULT_DECK, curModel: BASIC_ID, nextPos: 1, sortType: "noteFld", sortBackwards: false, addToCur: true, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, schedVer: 2 };
    db.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')").run(
      Math.floor(new Date(now).setHours(4, 0, 0, 0) / 1000),
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify(NOTE_TYPES),
      JSON.stringify(ankiDecks),
      JSON.stringify(DECK_CONFIG)
    );

    const addNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const addCard = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    let id = now; // note and card ids: unique within the package; Anki gives new ones where they clash
    let position = 0;
    db.exec("BEGIN");
    for (const deck of decks) {
      for (const card of cardsOf(library, deck.id)) {
        const { mid, fields, ords } = noteOf(card, deck);
        const noteId = id++;
        const mod = Math.floor((card.updated ?? card.created ?? now) / 1000);
        addNote.run(noteId, guidOf(card.id), mid, mod, tagsOf(card.tags), fields.join("\x1f"), unhtml(fields[0]), checksum(fields[0]));
        position++;
        for (const ord of ords) addCard.run(id++, noteId, deckIds.get(deck.id), ord, seconds, position);
      }
    }
    db.exec("COMMIT");
    db.close();
    return writeZip([
      { name: "collection.anki2", data: readFileSync(path) },
      { name: "media", data: Buffer.from("{}") }
    ], { date: new Date(now) });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// ── Reading ──
//
// A package from Anki (.apkg, decks; .colpkg, a whole collection) → a card list in the shape
// readCardList gives (format "apkg"), so an import goes on as from a text file: the same preview,
// duplicates and backup. Anki has written three kinds of collection over the years, newest first:
//   collection.anki21b  zstd-compressed, schema 18: note types, fields and decks in tables of their own
//   collection.anki21   schema 11 (Anki 2.1, and "Support older Anki versions")
//   collection.anki2    schema 11 (Anki 2.0, genanki and Dracosh); next to a newer one, only a stub
// A note's deck is the one its cards are in (for a card in a filtered deck, the one it came from). Its
// note type's kind says how to read it, never its name, which Anki gives in its own language: a cloze
// type's first field is the text with gaps and the next Anki's Extra, shown after the answer (an
// example); other types' fields are read by their names when those say (Word, Meaning, Sentence…),
// otherwise as front and back in order. Dracosh's own note types come back exactly, with how each
// deck asks. A deck with reverse cards asks both ways. Pictures and sounds stay out; image occlusion
// notes (masks over a picture) are listed as left out. Progress in Anki isn't brought over.

const COLLECTIONS = ["collection.anki21b", "collection.anki21", "collection.anki2"];
const notAnki = (why) => Object.assign(new Error(why), { code: "NOT_ANKI" });

export async function readApkg(file) {
  const { DatabaseSync } = await loadSqlite();
  let files;
  try {
    files = await readZip(file, COLLECTIONS);
  } catch (err) {
    throw ["NOT_ZIP", "DAMAGED_ZIP", "ZIP64", "Z_DATA_ERROR", "Z_BUF_ERROR"].includes(err.code) ? notAnki(err.message) : err;
  }
  const name = COLLECTIONS.find((each) => files.has(each));
  if (!name) throw notAnki("No collection in the package");
  const folder = mkdtempSync(join(tmpdir(), "dracosh-apkg-"));
  try {
    const path = join(folder, "collection.db");
    let db;
    try {
      writeFileSync(path, name.endsWith("b") ? unzstd(files.get(name)) : files.get(name));
      if (name.endsWith("b")) dropUnicase(DatabaseSync, path);
      db = new DatabaseSync(path, { readOnly: true });
      return readCollection(db);
    } catch (err) {
      // not a database, not zstd, or a collection without what Anki keeps in one
      const unreadable = err.code === "ERR_SQLITE_ERROR" || String(err.code).startsWith("ZSTD_") || err instanceof SyntaxError || err instanceof TypeError;
      throw unreadable ? notAnki(err.message) : err;
    } finally {
      db?.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// Anki compares names with a collation of its own ("unicase") that plain SQLite doesn't have, and
// won't read those tables without it. This copy is a throwaway one, so the collation is taken out of
// its schema: names are only read here, never sorted or looked up.
function dropUnicase(DatabaseSync, path) {
  const db = new DatabaseSync(path, { defensive: false });
  try {
    db.exec("PRAGMA writable_schema = ON");
    db.prepare("UPDATE sqlite_master SET sql = replace(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'").run();
    db.exec("PRAGMA writable_schema = OFF");
  } finally {
    db.close();
  }
}

// field `number` of a protobuf message, when it's a number (schema 18 keeps a note type's settings so)
function protobufNumber(bytes, number) {
  let at = 0;
  const varint = () => {
    let value = 0;
    for (let shift = 0; at < bytes.length; shift += 7) {
      const byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) break;
    }
    return value;
  };
  while (at < bytes.length) {
    const key = varint();
    const wire = key % 8;
    if (wire === 0) {
      const value = varint();
      if (Math.floor(key / 8) === number) return value;
    } else if (wire === 1) at += 8;
    else if (wire === 2) at += varint();
    else if (wire === 5) at += 4;
    else return null;
  }
  return null;
}

const CLOZE_KIND = 1;

// → { types: Map id → { name, cloze, fields: [names] }, decks: Map id → name }
function schema18(db) {
  const types = new Map(db.prepare("SELECT id, name, config FROM notetypes").all().map(({ id, name, config }) => [id, { name, cloze: protobufNumber(config, 1) === CLOZE_KIND, fields: [] }]));
  for (const { ntid, ord, name } of db.prepare("SELECT ntid, ord, name FROM fields").all()) if (types.has(ntid)) types.get(ntid).fields[ord] = name;
  const decks = new Map(db.prepare("SELECT id, name FROM decks").all().map(({ id, name }) => [id, name.replaceAll("\x1f", "::")]));
  return { types, decks };
}

function schema11(db) {
  const col = db.prepare("SELECT models, decks FROM col").get();
  const types = new Map(Object.values(JSON.parse(col.models)).map((type) => [Number(type.id), { name: type.name, cloze: type.type === CLOZE_KIND, fields: [...type.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) }]));
  const decks = new Map(Object.values(JSON.parse(col.decks)).map((deck) => [Number(deck.id), deck.name]));
  return { types, decks };
}

const MEDIA = /<img\b|\[sound:/i;
const IMAGE_OCCLUSION = /\{\{c\d+::image-occlusion:/;
const textOf = (html) => htmlLines(html).join(" ");

function readCollection(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  if (!tables.has("notes") || !tables.has("cards") || !tables.has("col")) throw notAnki("Not an Anki collection");
  const { types, decks } = tables.has("notetypes") ? schema18(db) : schema11(db);
  const cardsOfNote = new Map();
  for (const { nid, did, odid, ord } of db.prepare("SELECT nid, did, odid, ord FROM cards ORDER BY ord").all()) {
    if (!cardsOfNote.has(nid)) cardsOfNote.set(nid, []);
    cardsOfNote.get(nid).push({ deck: odid || did, ord });
  }

  const items = [];
  const asks = new Map(); // deck name → how its notes ask: { forward, backward, both } counts
  let media = 0;
  db.prepare("SELECT id, mid, flds FROM notes ORDER BY id")
    .all()
    .forEach((note, i) => {
      const type = types.get(note.mid) ?? { name: "", cloze: false, fields: [] };
      const values = note.flds.split("\x1f");
      const byName = (name) => values[type.fields.indexOf(name)] ?? "";
      const cards = cardsOfNote.get(note.id) ?? [];
      const deck = decks.get(cards[0]?.deck) ?? null;
      if (values.some((value) => MEDIA.test(value))) media++;
      const item = { line: i + 1, deck, direction: null, source: values.slice(0, 2).map(textOf).filter(Boolean).join(" = ") };
      // a picture card is named by its header, or its picture's file
      const picture = () => values.slice(1).map(textOf).find(Boolean) ?? values.join(" ").match(/<img[^>]*src="([^"]+)"/i)?.[1] ?? "";
      if (type.cloze && IMAGE_OCCLUSION.test(values[0])) return items.push({ ...item, source: picture(), skip: "picture", fields: noteFields({}) });

      let fields;
      let ask = null;
      if (note.mid === BASIC_ID || (type.name === "Dracosh" && type.fields.includes("Forward"))) {
        fields = noteFields({ front: byName("Front"), back: byName("Back"), example: byName("Example") });
        const [forward, backward] = [byName("Forward"), byName("Backward")].map((flag) => Boolean(textOf(flag)));
        ask = forward && backward ? "both" : backward ? "backward" : "forward";
      } else if (note.mid === CLOZE_ID || (type.name === "Dracosh Cloze" && type.fields.includes("Hint"))) {
        fields = noteFields({ front: byName("Text"), back: byName("Hint"), example: byName("Example"), cloze: true, hint: true });
      } else if (type.cloze) {
        fields = noteFields({ front: values[0], back: values[1], cloze: true });
      } else {
        const roles = columnsFrom(type.fields.length >= 2 ? type.fields : null);
        fields = noteFields({ front: values[roles.front], back: values[roles.back], example: roles.example === null ? "" : values[roles.example] });
        const ords = new Set(cards.map((card) => card.ord));
        ask = ords.has(0) && cards.some((card) => card.ord > 0) ? "both" : "forward";
      }
      if (ask && deck) {
        const counts = asks.get(deck) ?? { forward: 0, backward: 0, both: 0 };
        counts[ask]++;
        asks.set(deck, counts);
      }
      items.push({ ...item, fields });
    });
  // a deck asks the way most of its notes do
  for (const item of items) {
    const counts = asks.get(item.deck);
    if (counts) item.direction = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  return { format: "apkg", separator: null, header: {}, items, columns: null, ignored: [], unknown: [], anki: true, html: true, media };
}
