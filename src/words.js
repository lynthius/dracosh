import { t } from "./i18n.js";
import { deckLanguages } from "./language.js";
import { cardsOf, findDeck, toWords } from "./library.js";
import { loadLibrary } from "./store.js";

// The words of one library deck, read fresh every time, so cards added from another terminal
// (with /add) show up at the next question. `deckRef` is a deck name or id; empty = your first own
// deck, or the tour while you have none.
export function missingDeck(library, deckRef) {
  const names = library.decks.map((d) => `"${d.name}"`).join(", ");
  return new Error(deckRef ? t("errors.noDeck", { deck: deckRef, decks: names || t("errors.noDecksYet") }) : t("errors.emptyLibrary"));
}

export async function loadWords(deckRef) {
  const library = await loadLibrary();
  const deck = deckRef ? findDeck(library, deckRef) : (library.decks.find((d) => !d.tour) ?? library.decks[0]);
  if (!deck) throw missingDeck(library, deckRef);
  const cards = cardsOf(library, deck.id);
  // the tour is written in the UI's language on both sides: no pair to show or check by
  return { words: toWords(cards), deck: { name: deck.name, languages: deck.tour ? null : deckLanguages(deck, cards), directions: deck.directions, tour: Boolean(deck.tour) } };
}

// every deck of yours (not the tour), for "is anything still waiting today?"
export async function loadAllWords() {
  const library = await loadLibrary();
  return library.decks.filter((deck) => !deck.tour).map((deck) => ({ words: toWords(cardsOf(library, deck.id)), deck: { name: deck.name, directions: deck.directions } }));
}
