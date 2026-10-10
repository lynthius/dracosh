import { addCard, createDeck } from "./library.js";

// The deck a fresh install starts with: a short tour that teaches Dracosh by doing. Every card says
// exactly what to type, and the line shown after the answer explains the next thing. It's a `tour`
// deck: every card is asked once, in this order, and never comes back as a review. `Backticks` mark
// what to type (or a command); the quiz shows them highlighted, in the tour only. Answers never start with "/", because "/" opens the commands.
export const STARTER_DECK = "Getting started";
// bump it when the cards below change: an older copy of the tour in someone's library gets replaced
const STARTER_VERSION = 5;

const STARTER_CARDS = [
  { front: "Welcome! Every few minutes a card asks you something. Type the answer and press Enter. Try it and type `hello`", back: ["hello"], example: "Press `Enter` now for the next card, or wait and it will come by itself." },
  { front: "Small typos still count. Type `dragon`, but miss a letter on purpose (like `dragn`)", back: ["dragon"], example: "A typo counts as right, and Dracosh shows you the correct spelling." },
  { front: "A card can accept more than one answer. What is 2 + 2? (`4` and `four` both work)", back: ["4", "four"], example: "Every right answer moves a card to a later box, so you see it less and less often." },
  { front: "Stuck? Type `/hint` and press Enter, and the answer shows up letter by letter. Try it, then type `apple`", back: ["apple"], example: "A hinted answer still counts, but the card stays in its box for now." },
  { front: "What is your dragon's secret name? Nobody knows, so get this one wrong on purpose and type `dog`", back: ["Asogaras"], example: "In your own decks a missed card comes back sooner. If you were marked wrong by mistake, type `/correct` now." },
  { front: "Type `/` at any time to see all commands. Try `/badges` after this card. For now, type `ok`", back: ["ok", "okay"], example: "`/stats` shows your calendar, `/companion` your dragon, `/settings` how often cards come." },
  { front: "Answer cards every day to keep your streak. Your dragon grows with it. Type `every day`", back: ["every day", "everyday", "daily"], example: "Miss a day and a freeze saves your streak, if you have one left." },
  { front: "Need a break? `/snooze 1h` pauses the cards for an hour. For now, type `later`", back: ["later"], example: "Leave Dracosh alone for a few minutes and the dragon dozes off. Any key wakes it." },
  { front: "That's the tour! Type `done`", back: ["done"], example: "Now make it yours and type `/add` to start your own deck. The tour makes room for it." }
];

// the tour as an earlier version created it (the first one had no version number yet)
const isStarter = (deck) => deck.starter !== undefined || (deck.name === STARTER_DECK && deck.type === "qa" && !deck.languages);

// Adds the tour to an empty library, or brings an older copy of it up to date (its progress is
// dropped with the old cards). Returns true when the library changed and needs saving.
export function seedLibrary(library, now = Date.now()) {
  let deck = library.decks.find(isStarter);
  if (library.decks.length && !deck) return false;
  if (deck && (deck.starter ?? 1) >= STARTER_VERSION) return false;

  if (deck) library.cards = library.cards.filter((card) => card.deckId !== deck.id);
  else deck = createDeck(library, { name: STARTER_DECK, type: "qa", answerMode: "typed", languages: null, directions: "forward", tour: true, now });
  Object.assign(deck, { tour: true, starter: STARTER_VERSION });
  for (const card of STARTER_CARDS) addCard(library, deck.id, { ...card, now });
  return true;
}
