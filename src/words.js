import { t } from "./i18n.js";
import { deckLanguages, homeLanguages, learningSide } from "./language.js";
import { cardsOf, findDeck, toWords } from "./library.js";
import { loadLibrary } from "./store.js";

// The words of one library deck, read fresh every time, so cards added from another terminal
// (with /add) show up at the next question. `deckRef` is a deck name or id; empty = your first own
// deck, or the tour while you have none.
export function missingDeck(library, deckRef) {
  const names = library.decks.map((d) => `"${d.name}"`).join(", ");
  return new Error(deckRef ? t("errors.noDeck", { deck: deckRef, decks: names || t("errors.noDecksYet") }) : t("errors.emptyLibrary"));
}

// a deck as the quiz needs it: its name, languages, the one you're learning, which way it asks
function describe(library, deck, cards) {
  // the tour is written in the UI's language on both sides: no pair to show or check by
  const languages = deck.tour ? null : deckLanguages(deck, cards);
  const home = homeLanguages({ others: library.decks.filter((d) => d !== deck && d.languages).map((d) => d.languages) });
  return { name: deck.name, languages, learning: deck.tour ? null : learningSide(languages, deck, home), directions: deck.directions, tour: Boolean(deck.tour) };
}

const DIRECTION_KEYS = { forward: ["en-pl"], backward: ["pl-en"], both: ["en-pl", "pl-en"] };

// `deckRef` may also be several decks practised together (a list of names or ids) or "all" of yours:
// their cards mixed, each card carrying its own deck (`word.deck`) and the way that deck asks. Decks of
// the list that are gone are left out; with none left, it's your first deck again.
export async function loadWords(deckRef) {
  const library = await loadLibrary();
  if (deckRef === "all" || Array.isArray(deckRef)) {
    const own = library.decks.filter((d) => !d.tour);
    const decks = deckRef === "all" ? own : [...new Set(deckRef.map((ref) => findDeck(library, ref)).filter((d) => d && !d.tour))];
    if (decks.length >= 2 || (deckRef === "all" && decks.length)) {
      const words = decks.flatMap((deck) => {
        const cards = cardsOf(library, deck.id);
        const info = describe(library, deck, cards);
        return toWords(cards).map((word) => ({ ...word, deck: info, directions: word.directions ?? DIRECTION_KEYS[deck.directions] ?? DIRECTION_KEYS.both }));
      });
      return { words, deck: { name: decks.map((d) => d.name).join(" + "), mixed: decks.map((d) => d.name), all: deckRef === "all", languages: null, learning: null, directions: "both", tour: false } };
    }
    return loadWords(decks[0]?.id);
  }
  const deck = deckRef ? findDeck(library, deckRef) : (library.decks.find((d) => !d.tour) ?? library.decks[0]);
  if (!deck) throw missingDeck(library, deckRef);
  const cards = cardsOf(library, deck.id);
  return { words: toWords(cards), deck: describe(library, deck, cards) };
}

// every deck of yours (not the tour), for "is anything still waiting today?"
export async function loadAllWords() {
  const library = await loadLibrary();
  return library.decks.filter((deck) => !deck.tour).map((deck) => ({ words: toWords(cardsOf(library, deck.id)), deck: { name: deck.name, directions: deck.directions } }));
}
