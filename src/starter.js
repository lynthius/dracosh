import { addCard, createDeck } from "./library.js";

// The deck a fresh install starts with: a short tour that teaches Dracosh by doing. Every card says
// exactly what to type, and the line shown after the answer explains the next thing. The deck is
// ordered, so new cards come in this order. Answers never start with "/", because "/" opens the commands.
export const STARTER_DECK = "Getting started";

const STARTER_CARDS = [
  { front: "Welcome! Every few minutes a card asks you something. Type the answer and press Enter. Try it: type hello", back: ["hello"], example: "Press Enter now for the next card, or wait and it will come by itself." },
  { front: "Small typos still count. Type dragon, but miss a letter on purpose (like dragn)", back: ["dragon"], example: "A typo counts as right, and Dracosh shows you the correct spelling." },
  { front: "A card can accept more than one answer. What is 2 + 2? (4 and four both work)", back: ["4", "four"], example: "Every right answer moves a card to a later box, so you see it less and less often." },
  { front: "Stuck? Type /hint and press Enter: the answer shows up letter by letter. Try it, then type the word: apple", back: ["apple"], example: "A hinted answer still counts, but the card stays in its box for now." },
  { front: "Get this one wrong on purpose: type dog. (The right answer is cat.)", back: ["cat"], example: "A missed card comes back sooner. If you were marked wrong by mistake, type /correct now." },
  { front: "Type / at any time to see all commands. Try /badges after this card. For now, type: ok", back: ["ok", "okay"], example: "/stats shows your calendar, /companion your dragon, /settings how often cards come." },
  { front: "Answer cards every day to keep your streak. Your dragon grows with it. Type: every day", back: ["every day", "everyday", "daily"], example: "Miss a day and a freeze saves your streak, if you have one left." },
  { front: "Need a break? /snooze 1h pauses the cards for an hour. For now, type: later", back: ["later"], example: "Leave Dracosh alone for a few minutes and the dragon dozes off. Any key wakes it." },
  { front: "That's the tour! Your own decks are next: see dracosh --help. Type: done", back: ["done"], example: "This deck stays here for practice. Have fun!" }
];

// Adds the starter deck to an empty library; returns true when it did.
export function seedLibrary(library, now = Date.now()) {
  if (library.decks.length) return false;
  const deck = createDeck(library, { name: STARTER_DECK, type: "qa", answerMode: "typed", languages: null, directions: "forward", ordered: true, now });
  for (const card of STARTER_CARDS) addCard(library, deck.id, { ...card, now });
  return true;
}
