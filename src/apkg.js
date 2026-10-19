import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { columnRole, htmlLines, noteFields } from "./cardlist.js";
import { GAP } from "./cardline.js";
import { escapeHtml } from "./exporter.js";
import { cardsOf } from "./library.js";
import { loadSqlite, unzstd } from "./sqlite.js";
import { readZip, writeZip } from "./zip.js";

// An Anki deck package (.apkg): a zip with the collection as an SQLite file, in the schema Anki
// writes with "Support older Anki versions" (schema 11, as genanki writes it), so every Anki
// since 2.1 opens it, and AnkiDroid and AnkiMobile too.
//
// The package brings its own two note types, so it opens the same in an Anki set up in any language
// (a text file can only name a note type, and Anki names its own in its language):
//   Dracosh        Front, Back (one answer a line), Example, Forward, Backward: a card is made for
//                  each way the deck asks ("y" in Forward and/or Backward), as Anki's own "optional
//                  reversed card" does
//   Dracosh Cloze  Text ({{c1::…}} for each gap), Hint (shown with the gap), Example
// Their ids are fixed and they only change with NOTE_TYPES_VERSION, so a second export reuses the
// note types already in Anki. Each note's guid comes from the card's id, so it updates the notes
// already there instead of adding them again (Anki updates a note when it's newer: changing how a
// deck asks makes its notes newer too). Progress isn't written: the cards arrive as new.

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
    // Braces kept as text ("\{{") go to Anki as "&#123;{", which it shows as "{{" but never reads as a
    // gap; in a gap, "::" would start Anki's hint, so it goes as ":&#58;" for the same reason
    const text = card.front
      .split(GAP)
      .map((part, i) => (i % 2 ? `{{c${++gap}::${escapeHtml(part).replace(/::/g, ":&#58;")}}}` : escapeHtml(part.replace(/\\\{\{/g, "{{")).replace(/\{\{/g, "&#123;{")))
      .join("");
    return { mid: CLOZE_ID, fields: [text, escapeHtml(card.back.join("; ")), example], ords: [...Array(gap).keys()] };
  }
  const forward = deck.directions !== "backward";
  const backward = deck.directions !== "forward";
  const fields = [escapeHtml(card.front), card.back.map(escapeHtml).join("<br>"), example, forward ? "y" : "", backward ? "y" : ""];
  return { mid: BASIC_ID, fields, ords: [...(forward ? [0] : []), ...(backward ? [1] : [])] };
}

// The decks' cards as an .apkg file → Buffer. SQLite is loaded only here, for this.
export async function toApkg(library, decks, { now = Date.now() } = {}) {
  const { DatabaseSync } = await loadSqlite();
  const folder = mkdtempSync(join(tmpdir(), "dracosh-apkg-"));
  try {
    const path = join(folder, "collection.anki2");
    const db = new DatabaseSync(path);
    try {
      writeCollection(db, library, decks, now);
    } finally {
      db.close();
    }
    return writeZip(
      [
        { name: "collection.anki2", data: readFileSync(path) },
        { name: "media", data: Buffer.from("{}") }
      ],
      { date: new Date(now) }
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function writeCollection(db, library, decks, now) {
  db.exec(SCHEMA);
  const seconds = Math.floor(now / 1000);
  // a package always has Anki's Default deck (id 1); a Dracosh deck called that is that deck, or Anki
  // would see two of the same name
  const isDefault = (deck) => deck.name.trim().toLowerCase() === "default";
  const deckIds = new Map(decks.map((deck) => [deck.id, isDefault(deck) ? DEFAULT_DECK : deckIdOf(deck.id)]));
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
      const mod = Math.floor(Math.max(card.updated ?? card.created ?? now, deck.updated ?? 0) / 1000);
      addNote.run(noteId, guidOf(card.id), mid, mod, tagsOf(card.tags), fields.join("\x1f"), unhtml(fields[0]), checksum(fields[0]));
      position++;
      for (const ord of ords) addCard.run(id++, noteId, deckIds.get(deck.id), ord, seconds, position);
    }
  }
  db.exec("COMMIT");
}

// ── Reading ──
//
// A package from Anki (.apkg, decks; .colpkg, a whole collection) → a card list in the shape
// readCardList gives (format "apkg"), so an import goes on as from a text file: the same preview,
// duplicates and backup. Anki has written three kinds of collection over the years, newest first:
//   collection.anki21b  zstd-compressed, schema 18: note types, fields and decks in tables of their own
//   collection.anki21   schema 11 (Anki 2.1, and "Support older Anki versions")
//   collection.anki2    schema 11 (Anki 2.0, genanki and Dracosh); next to a newer one, only a stub
// A note's deck is the one its cards are in (for a card in a filtered deck, the one it came from).
// How to read a note comes from its note type, never its name, which Anki gives in its own language:
// a cloze type's text is the field its template puts {{cloze:…}} on, and the next field Anki's
// Extra, shown after the answer (an example). Any other type's front is the field its first template
// asks; its answer the field named so (Meaning, Translation, or after a language: "English"), else the
// next one its answer side shows; an example the field named so (Sentence, Example). Dracosh's own
// note types come back exactly, with how each deck asks. A deck with reverse cards asks both ways.
// Pictures and sounds stay out; image occlusion notes (masks over a picture) and notes that are only a
// picture or a sound are listed as left out. Progress in Anki isn't brought over; tags are.

const COLLECTIONS = ["collection.anki21b", "collection.anki21", "collection.anki2"];
const notAnki = (why) => Object.assign(new Error(why), { code: "NOT_ANKI" });

export async function readApkg(file) {
  const { DatabaseSync } = await loadSqlite();
  let files;
  try {
    files = await readZip(file, COLLECTIONS, { first: true });
  } catch (err) {
    throw ["NOT_ZIP", "DAMAGED_ZIP", "Z_DATA_ERROR", "Z_BUF_ERROR"].includes(err.code) ? notAnki(err.message) : err;
  }
  const [name, packed] = [...files][0] ?? [];
  if (!name) throw notAnki("No collection in the package");
  const folder = mkdtempSync(join(tmpdir(), "dracosh-apkg-"));
  try {
    const path = join(folder, "collection.db");
    let db;
    try {
      writeFileSync(path, name.endsWith("b") ? unzstd(packed) : packed);
      dropUnicase(DatabaseSync, path);
      db = new DatabaseSync(path, { readOnly: true, defensive: true });
      return readCollection(db);
    } catch (err) {
      // not a database, not zstd, or not what Anki keeps in one
      throw err.code === "ERR_SQLITE_ERROR" || String(err.code).startsWith("ZSTD_") || err instanceof SyntaxError ? notAnki(err.message) : err;
    } finally {
      db?.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// Anki compares names with a collation of its own ("unicase", schema 15 and later) that plain SQLite
// doesn't have, and won't read those tables without it. This copy is a throwaway one, so the
// collation is taken out of its schema: names are only read here, never sorted or looked up.
function dropUnicase(DatabaseSync, path) {
  const db = new DatabaseSync(path, { defensive: false });
  try {
    const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql LIKE '%unicase%'").all();
    if (!rows.length) return;
    db.exec("PRAGMA writable_schema = ON");
    const update = db.prepare("UPDATE sqlite_master SET sql = ? WHERE type = ? AND name = ?");
    for (const { type, name, sql } of rows) update.run(sql.replace(/\s+COLLATE\s+unicase\b/gi, ""), type, name);
    db.exec("PRAGMA writable_schema = OFF");
  } finally {
    db.close();
  }
}

// a protobuf message's fields (schema 18 keeps note type and template settings so) → Map number →
// value: a number, or the bytes of a string or message
function protobuf(bytes) {
  const fields = new Map();
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
    const [number, wire] = [Math.floor(key / 8), key % 8];
    let value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      value = bytes.subarray(at, at + length);
      at += length;
    } else if (wire === 1 || wire === 5) at += wire === 1 ? 8 : 4;
    else break;
    if (value !== undefined && !fields.has(number)) fields.set(number, value);
  }
  return fields;
}

const CLOZE_KIND = 1;
const text = (bytes) => (bytes ? Buffer.from(bytes).toString("utf8") : "");

// → { types: Map id → { name, cloze, fields: [names], question, answer }, decks: Map id → name }:
// `question` and `answer`: the first template's two sides, to see which fields they show
function schema18(db) {
  const types = new Map(db.prepare("SELECT id, name, config FROM notetypes").all().map(({ id, name, config }) => [id, { name, cloze: protobuf(config).get(1) === CLOZE_KIND, fields: [], question: "", answer: "" }]));
  for (const { ntid, ord, name } of db.prepare("SELECT ntid, ord, name FROM fields").all()) if (types.has(ntid)) types.get(ntid).fields[ord] = name;
  for (const { ntid, ord, config } of db.prepare("SELECT ntid, ord, config FROM templates").all()) {
    if (ord !== 0 || !types.has(ntid)) continue;
    const settings = protobuf(config);
    Object.assign(types.get(ntid), { question: text(settings.get(1)), answer: text(settings.get(2)) });
  }
  const decks = new Map(db.prepare("SELECT id, name FROM decks").all().map(({ id, name }) => [id, name.replaceAll("\x1f", "::")]));
  return { types, decks };
}

function schema11(db) {
  const col = db.prepare("SELECT models, decks FROM col").get();
  const [models, decks] = [JSON.parse(col?.models ?? "null"), JSON.parse(col?.decks ?? "null")];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(models) || !isObject(decks) || !Object.values(models).every((type) => isObject(type) && Array.isArray(type.flds) && Array.isArray(type.tmpls))) throw notAnki("Not an Anki collection");
  const first = (type) => type.tmpls.find((template) => template?.ord === 0) ?? type.tmpls[0] ?? {};
  return {
    types: new Map(
      Object.values(models).map((type) => [
        Number(type.id),
        { name: String(type.name ?? ""), cloze: type.type === CLOZE_KIND, fields: [...type.flds].sort((a, b) => a.ord - b.ord).map((field) => String(field?.name ?? "")), question: String(first(type).qfmt ?? ""), answer: String(first(type).afmt ?? "") }
      ])
    ),
    decks: new Map(Object.values(decks).map((deck) => [Number(deck?.id), String(deck?.name ?? "")]))
  };
}

// the fields a template side shows, in order: "{{Front}}", "{{type:Back}}", "{{furigana:Reading}}"
const shownFields = (format) =>
  [...format.matchAll(/\{\{([^{}#^/][^{}]*)\}\}/g)]
    .map((match) => match[1].split(":").pop().trim())
    .filter((name) => name !== "FrontSide");
// a field named after what it holds, or after a language ("English", "Vocabulary-English")
const LANGUAGE_NAMED = /\b(english|polish|german|french|ukrainian|spanish|italian|portuguese|russian|japanese|chinese|korean|dutch|swedish|meaning|translation|definition)\b/i;

// which field holds the front, the answer and an example → { front, back, example } indexes
function rolesOf(type) {
  const index = (name) => type.fields.indexOf(name);
  const named = (role) => type.fields.findIndex((name, i) => i !== front && columnRole(name) === role);
  const asked = shownFields(type.question).map(index).find((i) => i >= 0);
  const front = asked ?? Math.max(0, type.fields.findIndex((name) => columnRole(name) === "front"));
  const found = (i) => (i >= 0 && i !== front ? i : undefined);
  const back =
    found(named("back")) ??
    found(type.fields.findIndex((name, i) => i !== front && LANGUAGE_NAMED.test(name.replace(/[-_]/g, " ")))) ??
    shownFields(type.answer).map(index).find((i) => found(i) !== undefined) ??
    type.fields.findIndex((_, i) => i !== front);
  const example = [named("example")].find((i) => i >= 0 && i !== back) ?? null;
  return { front, back, example };
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
  db.prepare("SELECT id, mid, flds, tags FROM notes ORDER BY id")
    .all()
    .forEach((note, i) => {
      const type = types.get(note.mid) ?? { name: "", cloze: false, fields: [], question: "", answer: "" };
      const values = String(note.flds).split("\x1f");
      const value = (at) => (at === null || at === undefined || at < 0 ? "" : (values[at] ?? ""));
      const byName = (name) => value(type.fields.indexOf(name));
      const cards = cardsOfNote.get(note.id) ?? [];
      const deck = decks.get(cards[0]?.deck) ?? null;
      const tags = String(note.tags ?? "").trim().split(/\s+/).filter(Boolean);
      const item = { line: i + 1, deck, direction: null, source: values.slice(0, 2).map(textOf).filter(Boolean).join(" = ") };
      // a picture card is named by its header, or its picture's file
      const picture = () => values.slice(1).map(textOf).find(Boolean) ?? values.join(" ").match(/<img[^>]*src="([^"]+)"/i)?.[1] ?? "";
      if (type.cloze && IMAGE_OCCLUSION.test(values[0])) return items.push({ ...item, source: picture(), skip: "picture", fields: noteFields({}) });

      let fields;
      let ask = null;
      let front = values[0];
      if (note.mid === BASIC_ID || (type.name === "Dracosh" && type.fields.includes("Forward"))) {
        front = byName("Front");
        fields = noteFields({ front, back: byName("Back"), example: byName("Example"), perLine: true });
        const [forward, backward] = [byName("Forward"), byName("Backward")].map((flag) => Boolean(textOf(flag)));
        ask = forward && backward ? "both" : backward ? "backward" : "forward";
      } else if (note.mid === CLOZE_ID || (type.name === "Dracosh Cloze" && type.fields.includes("Hint"))) {
        front = byName("Text");
        fields = noteFields({ front, back: byName("Hint"), example: byName("Example"), cloze: true, hint: true });
      } else if (type.cloze) {
        const clozeName = type.question.match(/\{\{(?:[^{}:]*:)*cloze:([^{}]+)\}\}/)?.[1]?.trim();
        const at = Math.max(0, type.fields.indexOf(clozeName));
        const extra = shownFields(type.answer).map((name) => type.fields.indexOf(name)).find((j) => j >= 0 && j !== at) ?? (at === 0 ? 1 : 0);
        front = value(at);
        fields = noteFields({ front, back: value(extra), cloze: true });
      } else {
        const roles = rolesOf(type);
        front = value(roles.front);
        fields = noteFields({ front, back: value(roles.back), example: value(roles.example) });
        ask = cards.some((card) => card.ord === 0) && cards.some((card) => card.ord > 0) ? "both" : "forward";
      }
      // a front that is only a picture or a sound has nothing to ask in text
      if (!fields.front && MEDIA.test(front)) return items.push({ ...item, source: item.source || picture(), skip: "mediaOnly", fields });
      if (values.some((field) => MEDIA.test(field))) media++;
      if (ask && deck) {
        const counts = asks.get(deck) ?? { forward: 0, backward: 0, both: 0 };
        counts[ask]++;
        asks.set(deck, counts);
      }
      items.push({ ...item, fields: { ...fields, ...(tags.length && { tags }) } });
    });
  // a deck asks the way most of its notes do
  for (const item of items) {
    const counts = asks.get(item.deck);
    if (counts) item.direction = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  return { format: "apkg", separator: null, header: {}, items, columns: null, ignored: [], unknown: [], anki: true, html: true, media };
}
