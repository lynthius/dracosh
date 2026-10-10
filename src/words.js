import { cardsOf, findDeck, toWords } from "./library.js";
import { loadLibrary } from "./store.js";

// The words of one library deck, read fresh every time, so cards added from another terminal
// (with /add) show up at the next question. `deckRef` is a deck name or id; empty = your first own
// deck, or the tour while you have none.
export function missingDeck(library, deckRef) {
  const names = library.decks.map((d) => `"${d.name}"`).join(", ");
  return new Error(deckRef ? `There's no deck called "${deckRef}". Your decks: ${names || "none yet"}.` : "Your library has no decks yet.");
}

export async function loadWords(deckRef) {
  const library = await loadLibrary();
  const deck = deckRef ? findDeck(library, deckRef) : (library.decks.find((d) => !d.tour) ?? library.decks[0]);
  if (!deck) throw missingDeck(library, deckRef);
  return { words: toWords(cardsOf(library, deck.id)), deck: { name: deck.name, languages: deck.languages, directions: deck.directions, tour: Boolean(deck.tour) } };
}
