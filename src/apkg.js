import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAP } from "./cardline.js";
import { escapeHtml, joinAnswers } from "./exporter.js";
import { cardsOf } from "./library.js";
import { loadSqlite } from "./sqlite.js";
import { writeZip } from "./zip.js";

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
