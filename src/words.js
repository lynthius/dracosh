import { cardsOf, findDeck, toWords } from "./library.js";
import { loadLibrary } from "./store.js";

// The words of one library deck, read fresh every time, so cards added from another terminal
// (`dracosh add`) show up at the next question. `deckRef` is a deck name or id; empty = the first deck.
export async function loadWords(deckRef) {
  const library = await loadLibrary();
  const deck = deckRef ? findDeck(library, deckRef) : library.decks[0];
  if (!deck) {
    const names = library.decks.map((d) => `"${d.name}"`).join(", ");
    throw new Error(deckRef ? `There's no deck called "${deckRef}". Your decks: ${names || "none yet"}.` : "Your library has no decks yet.");
  }
  return { words: toWords(cardsOf(library, deck.id)), deck: { name: deck.name, languages: deck.languages, directions: deck.directions, tour: Boolean(deck.tour) } };
}
