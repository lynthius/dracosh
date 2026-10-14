import { t } from "./i18n.js";
import { backupNow } from "./backup.js";
import { seedLibrary } from "./starter.js";
import { gapsOf } from "./cardline.js";
import { addCard, cardsOf, createDeck, emptyLibrary, findDeck, findDuplicate, removeDeck, setDirections as setLibraryDirections, setLanguages as setLibraryLanguages, typedSides, updateCard } from "./library.js";
import { deckLanguages } from "./language.js";
import { itemKey } from "./scheduler.js";
import { loadLibrary, saveLibrary } from "./store.js";

export const slashAnswer = () => t("errors.slashAnswer");
export const slashFront = () => t("errors.slashFront");

// in the quiz "/" opens the commands, so nothing you'd have to type may start with it
const slash = (text) => String(text ?? "").trim().startsWith("/");
function checkSlashes(deck, fields) {
  if (fields.cloze) {
    if (gapsOf(fields.front).some(slash)) throw new Error(slashAnswer());
    return;
  }
  const typed = typedSides(deck);
  if (typed.includes("back") && [fields.back].flat().some(slash)) throw new Error(slashAnswer());
  if (typed.includes("front") && slash(fields.front)) throw new Error(slashFront());
}

// Library changes made from inside the app (/add, /decks). Each one reads the library fresh, so nothing
// written meanwhile by another Dracosh window is lost. `load`, `save` and `backup` are the store's; the
// preview gallery passes its own, so nothing it does is saved.
export function libraryActions({ load = loadLibrary, save = saveLibrary, backup = backupNow } = {}) {
  async function deckNamed(library, deckName) {
    const deck = findDeck(library, deckName);
    if (!deck) throw new Error(t("errors.deckGone", { deck: deckName }));
    return deck;
  }

  return {
    // every deck, the tour too, with its card count: /decks switches between them
    async allDecks() {
      const library = await load();
      return library.decks.map((deck) => {
        const cards = cardsOf(library, deck.id);
        const sample = cards.find((card) => !card.cloze); // shows the deck's directions in /decks
        return { name: deck.name, cards: cards.length, tour: Boolean(deck.tour), directions: deck.directions, languages: deckLanguages(deck, cards), sample: sample ? { front: sample.front, back: sample.back } : null };
      });
    },

    // your decks (the tour isn't one), with how many cards each holds: /add lets you pick one
    async ownDecks() {
      const library = await load();
      return library.decks.filter((deck) => !deck.tour).map((deck) => ({ name: deck.name, cards: cardsOf(library, deck.id).length, directions: deck.directions }));
    },

    // A new deck, asked front → back until its first card says otherwise. Your first one replaces the
    // tour: it's removed (after a backup) and the ids of its cards are returned, so their progress can go too.
    async startDeck({ name }) {
      const library = await load();
      const tour = library.decks.find((d) => d.tour);
      let removed = [];
      if (tour) {
        await backup("before-delete");
        removed = removeDeck(library, tour.id);
      }
      const deck = createDeck(library, { name, languages: null, directions: "forward" });
      await save(library);
      return { deck, removed };
    },

    // → { deck, cardIds }: the session rests the directions no longer asked (session.setDirections).
    // A side that becomes an answer to type may not start with "/", so such a switch is refused.
    async setDirections(deckName, directions) {
      const library = await load();
      const found = await deckNamed(library, deckName);
      const cards = cardsOf(library, found.id);
      const typed = typedSides({ directions });
      const blocked = cards.find((card) => !card.cloze && typed.some((side) => [card[side]].flat().some(slash)));
      if (blocked) throw new Error(t("errors.slashSwitch", { text: [blocked.front, ...blocked.back].find(slash) }));
      const deck = setLibraryDirections(library, found.id, directions);
      await save(library);
      return { deck, cardIds: cards.map((card) => card.id) };
    },

    // → { front, back, guessed }: the languages set for the deck, or guessed from its cards
    async languagesOf(deckName) {
      const library = await load();
      const deck = await deckNamed(library, deckName);
      return deckLanguages(deck, cardsOf(library, deck.id));
    },

    // { front, back } from /decks; null goes back to guessing from the cards
    async setLanguages(deckName, languages) {
      const library = await load();
      const deck = setLibraryLanguages(library, (await deckNamed(library, deckName)).id, languages);
      await save(library);
      return deckLanguages(deck, cardsOf(library, deck.id));
    },

    // the deck with this name (ignoring case), if any: /add says so before asking anything else
    async existingDeck(name) {
      const deck = findDeck(await load(), name.trim());
      return deck && !deck.tour ? deck : null; // the tour is about to make room, so its name is free
    },

    // the card with this front already in the deck, if any: /add says so as you type
    async existingCard(deckName, front) {
      const library = await load();
      const deck = findDeck(library, deckName);
      return deck ? findDuplicate(library, deck.id, front) : null;
    },

    // → { card, duplicate }, like addCard
    async addCardTo(deckName, fields) {
      const library = await load();
      const deck = await deckNamed(library, deckName);
      checkSlashes(deck, fields);
      const result = addCard(library, deck.id, fields);
      if (result.card) await save(library);
      return result;
    },

    // Several cards at once (a pasted list), saved together → { added, duplicates }. Cards that can't be
    // added (a duplicate, a "/" answer) are skipped; the paste review has flagged them already.
    async addCardsTo(deckName, list) {
      const library = await load();
      const deck = await deckNamed(library, deckName);
      const added = [];
      const duplicates = [];
      for (const fields of list) {
        try {
          checkSlashes(deck, fields);
          const { card, duplicate } = addCard(library, deck.id, fields);
          if (card) added.push(card);
          else duplicates.push(duplicate);
        } catch {
          duplicates.push(null);
        }
      }
      if (added.length) await save(library);
      return { added, duplicates };
    },

    // A card fixed right after adding it (↑ in /add) → { card, staleKeys }: the progress keys it no
    // longer has (a gap removed, a cloze card turned plain or the other way round), for the session to drop
    async updateCardIn(deckName, cardId, fields) {
      const library = await load();
      const deck = await deckNamed(library, deckName);
      checkSlashes(deck, fields);
      const keysOf = (card) => (card.cloze ? gapsOf(card.front).map((_, i) => `c${i + 1}`) : ["en-pl", "pl-en"]).map((direction) => itemKey(card.id, direction));
      const before = library.cards.find((c) => c.id === cardId);
      const oldKeys = before ? keysOf(before) : [];
      const card = updateCard(library, cardId, fields);
      await save(library);
      const kept = new Set(keysOf(card));
      return { card, staleKeys: oldKeys.filter((key) => !kept.has(key)) };
    },

    // The app's language changed: the tour follows it. → { from, to }, its old and new name, or null
    // when there is no tour or nothing changed.
    async matchTourLanguage() {
      const library = await load();
      const tour = library.decks.find((d) => d.tour);
      const from = tour?.name;
      if (!tour || !seedLibrary(library)) return null;
      await save(library);
      return { from, to: library.decks.find((d) => d.tour).name };
    },

    // a reset is always preceded by a backup, so `dracosh restore` can undo it
    backupBeforeReset: () => backup("before-reset"),

    // "Everything" in the reset: your decks and cards go, and the tour comes back as on a fresh install
    async resetLibrary() {
      const library = emptyLibrary();
      seedLibrary(library);
      await save(library);
      return library.decks[0].name;
    }
  };
}

// the app's own: reads and writes ~/.dracosh
const actions = libraryActions();
export const { allDecks, ownDecks, startDeck, setDirections, languagesOf, setLanguages, existingDeck, existingCard, addCardTo, addCardsTo, updateCardIn, matchTourLanguage, backupBeforeReset, resetLibrary } = actions;
