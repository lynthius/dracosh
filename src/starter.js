import { entry, language, t } from "./i18n.js";
import { addCard, cardsOf, createDeck, findDeck } from "./library.js";

// The deck a fresh install starts with: a short tour that teaches Dracosh by doing. Its cards live in
// the locale (tour.cards): every card says exactly what to type, and the line shown after the answer
// explains the next thing. It's a `tour` deck: every card is asked once, in this order, and never
// comes back as a review. `Backticks` mark what to type (or a command); the quiz shows them
// highlighted, in the tour only. Answers never start with "/", because "/" opens the commands.
export const STARTER_DECK = "Getting started"; // the tour's English name, which the first versions were found by
// bump it when the cards change: an older copy of the tour in someone's library gets replaced
const STARTER_VERSION = 8;

// the tour as an earlier version created it (the first one had no version number yet)
const isStarter = (deck) => deck.starter !== undefined || (deck.name === STARTER_DECK && deck.type === "qa" && !deck.languages);

const tourCards = () => entry("tour.cards");

// The app's language changed: the tour's cards say the same in the new one. They keep their ids, so
// the cards already done stay done. The deck takes the new name unless one of yours has it.
function translateTour(library, deck, lang) {
  const cards = tourCards();
  cardsOf(library, deck.id).forEach((card, i) => Object.assign(card, { front: cards[i].front, back: [...cards[i].back], example: cards[i].example }));
  const name = t("tour.deck");
  if ((findDeck(library, name) ?? deck) === deck) deck.name = name;
  deck.tourLanguage = lang;
  return true;
}

// Adds the tour to an empty library, brings an older copy of it up to date (its progress is dropped
// with the old cards), or translates it into the app's language. Returns true when the library
// changed and needs saving.
export function seedLibrary(library, now = Date.now()) {
  let deck = library.decks.find(isStarter);
  if (library.decks.length && !deck) return false;
  const lang = language();
  const current = deck && (deck.starter ?? 1) >= STARTER_VERSION && cardsOf(library, deck.id).length === tourCards().length;
  if (current) return (deck.tourLanguage ?? "en") === lang ? false : translateTour(library, deck, lang);

  if (deck) {
    library.cards = library.cards.filter((card) => card.deckId !== deck.id);
    const name = t("tour.deck");
    if ((findDeck(library, name) ?? deck) === deck) deck.name = name;
  } else deck = createDeck(library, { name: t("tour.deck"), type: "qa", languages: null, directions: "forward", tour: true, now });
  Object.assign(deck, { tour: true, starter: STARTER_VERSION, tourLanguage: lang });
  for (const card of tourCards()) addCard(library, deck.id, { ...card, now });
  return true;
}
