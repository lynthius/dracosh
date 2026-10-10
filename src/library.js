import { randomBytes } from "node:crypto";
import { normalize } from "./judge.js";

// The card library: decks and their cards. Pure functions over a plain object; saving is the caller's job.
//
// Progress (state.items) is keyed by `${card.id}:${direction}`. Cards that came from Anki use the Anki
// note id as their id, so progress recorded by 0.1.0 (keyed by note id) carries over unchanged.
// New cards get a "c"-prefixed id, which can never collide with Anki's numeric ids.

export const LIBRARY_VERSION = 1;

export const CARD_TYPES = ["translation", "definition", "qa"];
export const ANSWER_MODES = ["typed", "self"];
const DEFAULT_ANSWER_MODE = { translation: "typed", definition: "typed", qa: "self" };

export const MAX_DECK_NAME = 40; // it has to fit the card's border and the header

export const emptyLibrary = () => ({ version: LIBRARY_VERSION, decks: [], cards: [] });

export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function cleanList(values) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v ?? "").trim()).filter(Boolean);
  return [...new Set(list)];
}

// → the library in its current shape. Throws on a file written by a newer Dracosh, so it's never overwritten.
export function upgradeLibrary(raw) {
  if (!raw) return emptyLibrary();
  if (raw.version > LIBRARY_VERSION) {
    throw new Error(`This library was saved by a newer version of Dracosh (format ${raw.version}). Please update Dracosh.`);
  }
  return { version: LIBRARY_VERSION, decks: raw.decks ?? [], cards: raw.cards ?? [] };
}

export const findDeck = (library, nameOrId) =>
  library.decks.find((deck) => deck.id === nameOrId) ?? library.decks.find((deck) => sameName(deck.name, nameOrId)) ?? null;

export function createDeck(library, { name, type = "translation", languages = { front: "en", back: "pl" }, answerMode, directions = "both", tour = false, now = Date.now() }) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("A deck needs a name.");
  if (trimmed.length > MAX_DECK_NAME) throw new Error(`Keep the deck name to ${MAX_DECK_NAME} characters or fewer.`);
  const existing = findDeck(library, trimmed);
  if (existing) throw new Error(`There is already a deck called "${existing.name}".`);
  if (!CARD_TYPES.includes(type)) throw new Error(`Unknown card type "${type}".`);
  const mode = answerMode ?? DEFAULT_ANSWER_MODE[type];
  if (!ANSWER_MODES.includes(mode)) throw new Error(`Unknown answer mode "${mode}".`);

  const deck = { id: newId("d"), name: trimmed, type, languages: languages ? { ...languages } : null, answerMode: mode, directions, tour, created: now };
  library.decks.push(deck);
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

// a card with the same front (ignoring case, accents and punctuation) in the same deck
export const findDuplicate = (library, deckId, front) => {
  const key = normalize(front);
  return library.cards.find((card) => card.deckId === deckId && normalize(card.front) === key) ?? null;
};

// → { card, duplicate }: `duplicate` is the existing card when the front is already in the deck (nothing is added then)
export function addCard(library, deckId, { front, back, example = "", tags = [], id, now = Date.now() }) {
  if (!library.decks.some((deck) => deck.id === deckId)) throw new Error("That deck doesn't exist.");
  const cleanFront = String(front ?? "").trim();
  const cleanBack = cleanList(back);
  if (!cleanFront) throw new Error("A card needs a front.");
  if (!cleanBack.length) throw new Error("A card needs at least one answer on the back.");

  const duplicate = findDuplicate(library, deckId, cleanFront);
  if (duplicate) return { card: null, duplicate };

  const card = { id: id ? String(id) : newId("c"), deckId, front: cleanFront, back: cleanBack, example: String(example).trim(), tags: cleanList(tags), created: now, updated: now };
  if (library.cards.some((c) => c.id === card.id)) throw new Error(`A card with id ${card.id} already exists.`);
  library.cards.push(card);
  return { card, duplicate: null };
}

export function updateCard(library, cardId, patch, now = Date.now()) {
  const card = library.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("That card doesn't exist.");
  if (patch.front !== undefined) {
    const front = String(patch.front).trim();
    if (!front) throw new Error("A card needs a front.");
    const duplicate = findDuplicate(library, card.deckId, front);
    if (duplicate && duplicate.id !== card.id) throw new Error(`"${front}" is already in this deck.`);
    card.front = front;
  }
  if (patch.back !== undefined) {
    const back = cleanList(patch.back);
    if (!back.length) throw new Error("A card needs at least one answer on the back.");
    card.back = back;
  }
  if (patch.example !== undefined) card.example = String(patch.example).trim();
  if (patch.tags !== undefined) card.tags = cleanList(patch.tags);
  card.updated = now;
  return card;
}

// The quiz's word shape, so the scheduler and session keep working unchanged.
export const toWords = (cards) => cards.map((card) => ({ noteId: card.id, word: card.front, translations: card.back, example: card.example }));
