import { t } from "./i18n.js";
import { gapsOf } from "./cardline.js";
import { readCardList } from "./cardlist.js";
import { frontKey } from "./judge.js";
import { addCard, cardsOf, createDeck, findDeck, frontIndex, MAX_DECK_NAME, removeDeck, typedSides, updateCard } from "./library.js";

// Importing a list of cards: reading the file, a plan of what it would change (shown before anything is
// saved), then that plan carried out. Pure apart from decodeText's input; the CLI does the asking.

// A file's text, read the way it was saved: UTF-8 (with or without a BOM), or UTF-16 (Excel's "Unicode
// text"). Anything else isn't guessed: → throws with the start of the file read as the usual legacy
// encodings, so the right --encoding can be picked.
export function decodeText(bytes, encoding = null) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (encoding) {
    let decoder;
    try {
      decoder = new TextDecoder(encoding);
    } catch {
      throw new Error(t("import.unknownEncoding", { encoding }));
    }
    return { text: decoder.decode(buffer), encoding: decoder.encoding };
  }
  const starts = (...prefix) => prefix.every((byte, i) => buffer[i] === byte);
  if (starts(0xff, 0xfe)) return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
  if (starts(0xfe, 0xff)) return { text: new TextDecoder("utf-16be").decode(buffer), encoding: "utf-16be" };
  // UTF-16 without a BOM: every other byte is zero in text that's mostly Latin
  const sample = buffer.subarray(0, 4000);
  const zeros = (offset) => sample.filter((byte, i) => i % 2 === offset && byte === 0).length;
  if (sample.length >= 4 && zeros(1) > sample.length * 0.3) return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
  if (sample.length >= 4 && zeros(0) > sample.length * 0.3) return { text: new TextDecoder("utf-16be").decode(buffer), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8" };
  } catch {
    const line = (label) => new TextDecoder(label).decode(buffer).split(/\r?\n/).find((l) => /[^\x00-\x7f]/.test(l)) ?? "";
    const samples = ["windows-1250", "windows-1252"].map((label) => ({ encoding: label, line: line(label).slice(0, 60) }));
    throw Object.assign(new Error(t("import.notUtf8")), { samples });
  }
}

// the same answers, maybe in another order: a fixed accent or letter case is a change
const answersKey = (back) => back.map((answer) => answer.trim()).sort().join("\u0001");

// → { decks: [{ name, deck (existing or null), direction, items }], problems, read: { format, separator,
// columns, ignored, count } }, each item one of:
//   { kind: "new", line, fields }            added
//   { kind: "same", line, fields, card }     already in the deck as it is: left alone
//   { kind: "changed", line, fields, card }  in the deck with other answers or example: asked about
// problems: [{ line, issue, text, first? }]: issue is noFront, noBack, noSeparator (a Dracosh line
// without " = "), slash (an answer to type starts with "/"), twice (first: the line it was on before),
// noDeck, tooLong (a deck name), tour (a deck name taken by the tour), picture (an Anki note that
// is a picture, from a package).
// `deck`: every card goes into this deck (--deck); `deckName`: the deck for cards the file doesn't put
// in one (what was asked). `directions`: { deck name: direction } picked for new decks.
// `split`: in a table, one answer listing several ("cat, kitty", "cat / kitty") becomes several;
// read.splittable says how many there are, with an example. `list`: the cards already read (an Anki
// package, by apkg.js), instead of `text`.
export function planImport(library, text, { deck: only = null, deckName = null, separator = null, csv = false, directions = {}, split = false, list: given = null } = {}) {
  const list = given ?? readCardList(text, { separator, csv });
  const decks = new Map();
  const problems = [];
  const seen = new Map(); // deck name + front → the line it was first on
  const fronts = new Map(); // deck id → its frontIndex
  const splittable = [];

  for (const { line, text: source } of list.unknown) problems.push({ line, issue: "badDirection", text: source });
  for (const item of list.items) {
    const name = fitName((only ?? item.deck ?? deckName ?? "").trim());
    let { fields } = item;
    const problem = (issue, extra = {}) => problems.push({ line: item.line, issue, text: item.source, ...extra });
    if (item.skip) {
      problem(item.skip);
      continue;
    }
    if (!fields.front) {
      problem("noFront");
      continue;
    }
    if (!fields.cloze && !fields.back.length) {
      problem(list.format === "lines" && !item.source.includes("=") ? "noSeparator" : "noBack");
      continue;
    }
    // a phrase ("Hello, world") is translated by a phrase, not a list
    const listed = (list.format === "table" || list.format === "apkg") && !fields.cloze && fields.back.length === 1 && !fields.front.includes(",") && listedAnswers(fields.back[0]);
    if (listed) {
      splittable.push(fields.back[0]);
      if (split) fields = { ...fields, back: listed };
    }
    if (!name) {
      problem("noDeck");
      continue;
    }
    if (Array.from(name).length > MAX_DECK_NAME) {
      problem("tooLong", { deck: name });
      continue;
    }
    const key = `${name.toLowerCase()}\u0001${frontKey(fields.front)}`;
    if (seen.has(key)) {
      problem("twice", { first: seen.get(key) });
      continue;
    }
    seen.set(key, item.line);

    if (!decks.has(name.toLowerCase())) {
      const deck = findDeck(library, name);
      decks.set(name.toLowerCase(), { name: deck?.name ?? name, deck, direction: deck ? deck.directions : item.direction, items: [] });
    }
    const target = decks.get(name.toLowerCase());
    if (target.deck?.tour) {
      problem("tour", { deck: target.deck.name });
      continue;
    }
    if (target.deck && !fronts.has(target.deck.id)) fronts.set(target.deck.id, frontIndex(library, target.deck.id));
    const existing = target.deck ? (fronts.get(target.deck.id).get(frontKey(fields.front)) ?? null) : null;
    const direction = target.deck?.directions ?? directions[target.name] ?? target.direction ?? "forward";
    if (slashIn(fields, direction)) {
      problem("slash");
      continue;
    }
    if (!existing) target.items.push({ kind: "new", line: item.line, fields });
    else {
      // the same answers in another order, or an example left out of the file, change nothing
      const sameBack = answersKey(existing.back) === answersKey(fields.back);
      const sameExample = !fields.example || fields.example === existing.example;
      const sameGaps = !(fields.cloze || existing.cloze) || fields.front === existing.front;
      target.items.push({ kind: sameBack && sameExample && sameGaps ? "same" : "changed", line: item.line, fields, card: existing });
    }
  }
  return {
    decks: [...decks.values()].filter((deck) => deck.items.length),
    problems,
    read: { anki: list.anki, html: list.html, media: list.media ?? 0, format: list.format, separator: list.separator, columns: list.columns, ignored: list.ignored, count: list.items.length, splittable: splittable.length, splitExample: splittable[0] ?? null }
  };
}

// Anki's nested decks ("Languages::Spanish::Verbs for travel") are long: one that doesn't fit keeps its
// last part, the deck the cards are really in
const fitName = (name) => (Array.from(name).length > MAX_DECK_NAME && name.includes("::") ? name.split("::").at(-1).trim() : name);

// "cat, kitty" or "cat / kitty": answers listed the way Anki and Quizlet decks often do → ["cat", "kitty"];
// null for a sentence ("Yes, I do.") or a single answer
function listedAnswers(answer) {
  if (/[.?!…]$/.test(answer.trim())) return null;
  const parts = answer.split(/\s*,\s+|\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 && parts.every((part) => part.split(/\s+/).length <= 3) ? parts : null;
}

// in the quiz "/" opens the commands, so nothing to be typed may start with it
const slashIn = (fields, directions) => {
  const slash = (text) => text.startsWith("/");
  if (fields.cloze) return gapsOf(fields.front).some(slash);
  return typedSides({ directions }).some((side) => [fields[side]].flat().some(slash));
};

// Carries out a plan. `update`: changed cards take the file's answers and example (their progress
// stays): true for all of them, or a Set of the card ids that were shown and agreed to; otherwise
// they're left as they are. `directions`: { deck name: direction } for new decks
// (forward when not given). → { added, updated, slash: [{ line, text }] (left out: an answer to type
// starts with "/"), decks: [{ name, isNew, added, updated }], removedTour: the tour's card ids (it goes
// once you have a deck of your own, as in /add; `keepTour` keeps it) }
export function applyImport(library, plan, { update = false, directions = {}, keepTour = false, now = Date.now() } = {}) {
  const result = { added: 0, updated: 0, slash: [], decks: [], removedTour: [] };
  for (const target of plan.decks) {
    let deck = target.deck && library.decks.find((d) => d.id === target.deck.id);
    const isNew = !deck;
    if (isNew) deck = createDeck(library, { name: target.name, directions: directions[target.name] ?? target.direction ?? "forward", now });
    const counts = { name: deck.name, isNew, added: 0, updated: 0 };
    const index = frontIndex(library, deck.id);
    for (const item of target.items) {
      const updating = item.kind === "changed" && (update === true || update?.has?.(item.card.id));
      if ((item.kind === "new" || updating) && slashIn(item.fields, deck.directions)) {
        result.slash.push({ line: item.line, text: item.fields.front });
        continue;
      }
      if (item.kind === "new") {
        addCard(library, deck.id, { ...item.fields, now }, index);
        counts.added++;
      } else if (updating) {
        updateCard(library, item.card.id, { front: item.fields.front, back: item.fields.back, cloze: item.fields.cloze, ...(item.fields.example && { example: item.fields.example }) }, now);
        counts.updated++;
      }
    }
    result.added += counts.added;
    result.updated += counts.updated;
    result.decks.push(counts);
  }
  // your first deck of your own replaces the tour, as in /add
  const tour = library.decks.find((d) => d.tour);
  if (tour && !keepTour && library.decks.some((d) => !d.tour && cardsOf(library, d.id).length)) result.removedTour = removeDeck(library, tour.id);
  return result;
}

// the items of a plan that would be asked about, saved, or left: for the preview
export const planCounts = (plan) => {
  const items = plan.decks.flatMap((deck) => deck.items);
  const count = (kind) => items.filter((item) => item.kind === kind).length;
  return { new: count("new"), same: count("same"), changed: count("changed"), problems: plan.problems.length };
};
