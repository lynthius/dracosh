import { t } from "./i18n.js";
import { randomBytes } from "node:crypto";
import { frontKey } from "./judge.js";
import { gapsOf } from "./cardline.js";

// The card library: decks and their cards. Pure functions over a plain object; saving is the caller's job.
//
// Progress (state.items) is keyed by `${card.id}:${direction}`. Cards that came from Anki use the Anki
// note id as their id, so progress recorded by 0.1.0 (keyed by note id) carries over unchanged.
// New cards get a "c"-prefixed id, which can never collide with Anki's numeric ids.

// 2: cloze cards, whose back may be empty (an older Dracosh would call such a library damaged)
export const LIBRARY_VERSION = 2;

// Older libraries carry a card type on each deck; every card is front = back now, so it's only kept.
export const CARD_TYPES = ["translation", "definition", "qa"];

// How a deck is asked: front → back, back → front, or both. Picked after its first card.
export const DIRECTIONS = ["forward", "backward", "both"];

// the sides of a card typed as an answer in the quiz: in the quiz "/" opens the commands, so neither
// may start with it. A cloze card is asked by its gaps, whatever the deck's direction.
export const typedSides = (deck) => (deck.directions === "forward" ? ["back"] : deck.directions === "backward" ? ["front"] : ["front", "back"]);

export const MAX_DECK_NAME = 40; // it has to fit the card's border and the header

export const emptyLibrary = () => ({ version: LIBRARY_VERSION, decks: [], cards: [] });

export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function cleanList(values) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v ?? "").trim()).filter(Boolean);
  return [...new Set(list)];
}

const isText = (value) => typeof value === "string";
const filled = (value) => isText(value) && value.trim() !== "";
const validDeck = (deck) => deck && isText(deck.id) && filled(deck.name); // odd languages are tidied below
// a cloze card's answers are its gaps, so its back (shown as a hint) may be empty
const validCard = (card) =>
  card && isText(card.id) && isText(card.deckId) && filled(card.front) && Array.isArray(card.back) && (card.cloze ? gapsOf(card.front).length > 0 : card.back.length > 0) && card.back.every(filled);
const broken = (why) => Object.assign(new Error(why), { damaged: true });

// → the library in its current shape (undefined: there's none yet). Throws on a file written by a newer
// Dracosh, so it's never overwritten, and on one that isn't a library, so nothing is lost by saving over it.
export function upgradeLibrary(raw) {
  if (raw === undefined) return emptyLibrary();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw broken(t("errors.why.notLibrary"));
  if (raw.version > LIBRARY_VERSION) {
    throw new Error(t("errors.newerLibrary", { format: raw.version }));
  }
  const decks = raw.decks ?? [];
  const cards = raw.cards ?? [];
  if (!Array.isArray(decks) || !decks.every(validDeck)) throw broken(t("errors.why.deck"));
  if (!Array.isArray(cards) || !cards.every(validCard)) throw broken(t("errors.why.card"));
  const deckIds = new Set(decks.map((deck) => deck.id));
  if (!cards.every((card) => deckIds.has(card.deckId))) throw broken(t("errors.why.cardDeck"));
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw broken(t("errors.why.cardIds"));
  // languages edited by hand ("EN", "pt-BR", "english") are tidied, or left to be guessed again
  const tidy = (languages) => {
    try {
      if (!languages || typeof languages !== "object") return null;
      return cleanLanguages({ front: String(languages.front).split(/[-_]/)[0], back: String(languages.back).split(/[-_]/)[0] });
    } catch {
      return null;
    }
  };
  return { version: LIBRARY_VERSION, decks: decks.map((deck) => ({ ...deck, languages: tidy(deck.languages) })), cards };
}

export const findDeck = (library, nameOrId) =>
  library.decks.find((deck) => deck.id === nameOrId) ?? library.decks.find((deck) => sameName(deck.name, nameOrId)) ?? null;

export function createDeck(library, { name, type = "translation", languages = null, directions = "both", tour = false, now = Date.now() }) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error(t("errors.deckNeedsName"));
  if (Array.from(trimmed).length > MAX_DECK_NAME) throw new Error(t("errors.deckNameTooLong", { max: MAX_DECK_NAME }));
  const existing = findDeck(library, trimmed);
  if (existing) throw new Error(t("errors.deckExists", { deck: existing.name }));
  if (!CARD_TYPES.includes(type)) throw new Error(`Unknown card type "${type}".`);
  if (!DIRECTIONS.includes(directions)) throw new Error(`Unknown direction "${directions}".`);

  const deck = { id: newId("d"), name: trimmed, type, languages: cleanLanguages(languages), directions, tour, created: now };
  library.decks.push(deck);
  return deck;
}

// Progress is kept per direction, so turning one off only stops asking it: its boxes stay for later.
// `updated` says when: an Anki package written later makes its notes ask the new way too
export function setDirections(library, deckId, directions, now = Date.now()) {
  if (!DIRECTIONS.includes(directions)) throw new Error(`Unknown direction "${directions}".`);
  const deck = library.decks.find((d) => d.id === deckId);
  if (!deck) throw new Error("That deck doesn't exist.");
  if (deck.directions !== directions) deck.updated = now;
  deck.directions = directions;
  return deck;
}

// `languages`: { front, back } as ISO 639-1 codes ("und": not one language), or null to go back to guessing
const LANGUAGE_CODE = /^[a-z]{2,3}$/;
function cleanLanguages(languages) {
  if (!languages) return null;
  const code = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
  const [front, back] = [code(languages.front), code(languages.back)];
  if (!LANGUAGE_CODE.test(front) || !LANGUAGE_CODE.test(back)) throw new Error(`Unknown language "${languages.front} → ${languages.back}".`);
  return { front, back };
}

export function setLanguages(library, deckId, languages) {
  const clean = cleanLanguages(languages);
  const deck = library.decks.find((d) => d.id === deckId);
  if (!deck) throw new Error("That deck doesn't exist.");
  deck.languages = clean;
  return deck;
}

// → the ids of the cards that went with it, so their progress can be dropped too
export function removeDeck(library, deckId) {
  const removed = cardsOf(library, deckId).map((card) => card.id);
  library.decks = library.decks.filter((deck) => deck.id !== deckId);
  library.cards = library.cards.filter((card) => card.deckId !== deckId);
  return removed;
}

export const cardsOf = (library, deckId) => library.cards.filter((card) => card.deckId === deckId);

// a card with the same front (ignoring case and punctuation: see frontKey) in the same deck. `index`,
// a Map of frontKey → card for the deck, saves reading every card again (an import adds thousands)
export const findDuplicate = (library, deckId, front, index = null) => {
  const key = frontKey(front);
  if (index) return index.get(key) ?? null;
  return library.cards.find((card) => card.deckId === deckId && frontKey(card.front) === key) ?? null;
};
export const frontIndex = (library, deckId) => new Map(cardsOf(library, deckId).map((card) => [frontKey(card.front), card]));

// → { card, duplicate }: `duplicate` is the existing card when the front is already in the deck (nothing is added then)
// `cloze`: the front has {{gaps}}, each asked as a card of its own; the back is then only a hint
// `index`: the deck's frontIndex, kept up to date here (see findDuplicate)
export function addCard(library, deckId, { front, back, example = "", tags = [], cloze = false, id, now = Date.now() }, index = null) {
  if (!library.decks.some((deck) => deck.id === deckId)) throw new Error("That deck doesn't exist.");
  const cleanFront = String(front ?? "").trim();
  const cleanBack = cleanList(back);
  const isCloze = Boolean(cloze) && gapsOf(cleanFront).length > 0;
  if (!cleanFront) throw new Error(t("errors.cardNeedsFront"));
  if (!cleanBack.length && !isCloze) throw new Error(t("errors.cardNeedsBack"));

  const duplicate = findDuplicate(library, deckId, cleanFront, index);
  if (duplicate) return { card: null, duplicate };

  const card = { id: id ? String(id) : newId("c"), deckId, front: cleanFront, back: cleanBack, example: String(example).trim(), tags: cleanList(tags), ...(isCloze && { cloze: true }), created: now, updated: now };
  if (id && library.cards.some((c) => c.id === card.id)) throw new Error(`A card with id ${card.id} already exists.`);
  library.cards.push(card);
  index?.set(frontKey(cleanFront), card);
  return { card, duplicate: null };
}

export function updateCard(library, cardId, patch, now = Date.now()) {
  const card = library.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("That card doesn't exist.");
  const front = patch.front !== undefined ? String(patch.front).trim() : card.front;
  const back = patch.back !== undefined ? cleanList(patch.back) : card.back;
  const cloze = (patch.cloze !== undefined ? Boolean(patch.cloze) : Boolean(card.cloze)) && gapsOf(front).length > 0;
  if (!front) throw new Error(t("errors.cardNeedsFront"));
  if (!back.length && !cloze) throw new Error(t("errors.cardNeedsBack"));
  const duplicate = findDuplicate(library, card.deckId, front);
  if (duplicate && duplicate.id !== card.id) throw new Error(t("errors.frontExists", { front }));
  Object.assign(card, { front, back });
  if (cloze) card.cloze = true;
  else delete card.cloze;
  if (patch.example !== undefined) card.example = String(patch.example).trim();
  if (patch.tags !== undefined) card.tags = cleanList(patch.tags);
  card.updated = now;
  return card;
}

// The quiz's word shape, so the scheduler and session keep working unchanged. A cloze card is asked one
// gap at a time ("c1", "c2"…), whatever the deck's direction.
export const toWords = (cards) =>
  cards.map((card) => ({
    noteId: card.id,
    word: card.front,
    translations: card.back,
    example: card.example,
    ...(card.cloze && { cloze: gapsOf(card.front), directions: gapsOf(card.front).map((_, i) => `c${i + 1}`) })
  }));
