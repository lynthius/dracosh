import { backupNow } from "./backup.js";
import { seedLibrary } from "./starter.js";
import { addCard, cardsOf, createDeck, emptyLibrary, findDeck, findDuplicate, removeDeck } from "./library.js";
import { loadLibrary, saveLibrary } from "./store.js";

// Library changes made from inside the app (/add for now). Each one reads the library fresh, so
// nothing written meanwhile by another Dracosh window is lost.

// every deck, the tour too, with its card count: /decks switches between them
export async function allDecks() {
  const library = await loadLibrary();
  return library.decks.map((deck) => ({ name: deck.name, cards: cardsOf(library, deck.id).length, tour: Boolean(deck.tour) }));
}

// your decks (the tour isn't one), with how many cards each holds: /add lets you pick one
export async function ownDecks() {
  const library = await loadLibrary();
  return library.decks.filter((deck) => !deck.tour).map((deck) => ({ name: deck.name, cards: cardsOf(library, deck.id).length }));
}

// A new deck. Your first one replaces the tour: it's removed (after a backup) and the ids of its cards are
// returned, so their progress can go too.
export async function startDeck({ name, bothWays }) {
  const library = await loadLibrary();
  const tour = library.decks.find((d) => d.tour);
  let removed = [];
  if (tour) {
    await backupNow("before-delete");
    removed = removeDeck(library, tour.id);
  }
  const deck = createDeck(library, { name, type: "translation", languages: null, directions: bothWays ? "both" : "forward" });
  await saveLibrary(library);
  return { deck, removed };
}

// the deck with this name (ignoring case), if any: /add says so before asking anything else
export const existingDeck = async (name) => {
  const deck = findDeck(await loadLibrary(), name.trim());
  return deck && !deck.tour ? deck : null; // the tour is about to make room, so its name is free
};

// the card with this front already in the deck, if any: /add says so before asking for the answer
export async function existingCard(deckName, front) {
  const library = await loadLibrary();
  const deck = findDeck(library, deckName);
  return deck ? findDuplicate(library, deck.id, front) : null;
}

// a reset is always preceded by a backup, so `dracosh restore` can undo it
export const backupBeforeReset = () => backupNow("before-reset");

// "Everything" in the reset: your decks and cards go, and the tour comes back as on a fresh install
export async function resetLibrary() {
  const library = emptyLibrary();
  seedLibrary(library);
  await saveLibrary(library);
  return library.decks[0].name;
}

// → { card, duplicate }, like addCard
export async function addCardTo(deckName, fields) {
  const library = await loadLibrary();
  const deck = findDeck(library, deckName);
  if (!deck) throw new Error(`The deck "${deckName}" is gone.`);
  const result = addCard(library, deck.id, fields);
  if (result.card) await saveLibrary(library);
  return result;
}
