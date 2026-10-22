import { language as uiLanguage, t } from "./i18n.js";
import { backupNow } from "./backup.js";
import { seedLibrary } from "./starter.js";
import { gapsOf } from "./cardline.js";
import { addCard, cardsOf, createDeck, emptyLibrary, emptyOldTrash, findDeck, findDuplicate, removeDeck, renameDeck as renameLibraryDeck, restoreDeck, setDirections as setLibraryDirections, setLanguages as setLibraryLanguages, trashDeck, trashedUntil, typedSides, updateCard } from "./library.js";
import { firstWords } from "./firstwords.js";
import { applyImport, planImport } from "./importer.js";
import { deckLanguages, homeLanguages, languageName, learningSide } from "./language.js";
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
// your own language, as your other decks with languages set suggest (see homeLanguages)
const homeOf = (library, deck) => homeLanguages({ others: library.decks.filter((d) => d !== deck && d.languages).map((d) => d.languages) });
const learningOf = (library, deck, languages = deckLanguages(deck, cardsOf(library, deck.id))) => learningSide(languages, deck, homeOf(library, deck));
const withLearning = (library, deck) => {
  const languages = deckLanguages(deck, cardsOf(library, deck.id));
  return { ...languages, learning: learningOf(library, deck, languages), home: homeOf(library, deck) };
};

// A language picked as the one you're learning is kept, unless it's what a sure guess says anyway: then
// the guess goes on following the deck (its name, your other decks)
function chooseLearning(library, deck, lang) {
  const languages = deckLanguages(deck, cardsOf(library, deck.id));
  if (lang && lang !== languages.front && lang !== languages.back) return; // only a language the deck has
  const guess = learningOf(library, { ...deck, learning: undefined });
  deck.learning = !lang || (guess?.sure && guess.lang === lang) ? undefined : lang;
}

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
        const languages = deckLanguages(deck, cards);
        return { name: deck.name, cards: cards.length, tour: Boolean(deck.tour), directions: deck.directions, languages, learning: learningOf(library, deck, languages), home: homeOf(library, deck), sample: sample ? { front: sample.front, back: sample.back } : null };
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

    // The welcome's deck of first words: the new word shown, yours typed (/decks can add the other way);
    // like a deck of your own, it replaces the tour.
    // Taken again (a welcome done twice), the deck made then is the one. → { deck, removed }
    async startFirstWords({ home, learning }) {
      const library = await load();
      const language = languageName(learning);
      const name = t("welcome.firstWordsDeck", { language: language.charAt(0).toLocaleUpperCase(uiLanguage()) + language.slice(1) });
      const pair = (deck) => deck.firstWords && deck.languages?.front === learning && deck.languages?.back === home;
      const existing = library.decks.find(pair);
      if (existing) return { deck: existing, removed: [] };
      // a deck of yours with that name keeps it: these get a number ("German: first words 2")
      let named = name;
      for (let n = 2; findDeck(library, named); n++) named = `${name} ${n}`;
      const tour = library.decks.find((d) => d.tour);
      let removed = [];
      if (tour) {
        await backup("before-delete");
        removed = removeDeck(library, tour.id);
      }
      const deck = createDeck(library, { name: named, languages: { front: learning, back: home }, directions: "forward" });
      deck.firstWords = true;
      for (const fields of firstWords(home, learning)) addCard(library, deck.id, fields);
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
    // (with `learning`: the language you're learning, see learningSide; null for a deck in one language)
    async languagesOf(deckName) {
      const library = await load();
      return withLearning(library, await deckNamed(library, deckName));
    },

    // { front, back, learning? } from /decks or /add (`learning`: a language code); null goes back to
    // guessing from the cards
    async setLanguages(deckName, languages) {
      const library = await load();
      const deck = setLibraryLanguages(library, (await deckNamed(library, deckName)).id, languages);
      if (languages?.learning !== undefined) chooseLearning(library, deck, languages.learning);
      await save(library);
      return withLearning(library, deck);
    },

    // the language you're learning in a deck (a code), from /decks → Learning → as it now stands
    async setLearning(deckName, lang) {
      const library = await load();
      const deck = await deckNamed(library, deckName);
      chooseLearning(library, deck, lang);
      await save(library);
      return learningOf(library, deck);
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

    // /decks → Rename → the deck as it's called now
    async renameDeck(oldName, newName) {
      const library = await load();
      const deck = renameLibraryDeck(library, (await deckNamed(library, oldName)).id, newName);
      await save(library);
      return deck;
    },

    // /decks → Delete, confirmed: a backup, then the deck goes to the trash with its cards and their
    // progress (`progressOf(cardIds)`, from the session). The last deck leaves the tour in its place.
    // → { entry, cardIds, next }: the trash entry, the cards gone (their progress goes from the
    // session too) and the deck to practise if this one was it
    async deleteDeck(name, progressOf = () => ({})) {
      await backup("before-delete");
      const library = await load();
      const deck = await deckNamed(library, name);
      const cardIds = cardsOf(library, deck.id).map((card) => card.id);
      const entry = trashDeck(library, deck.id, { progress: progressOf(cardIds) });
      if (!library.decks.length) seedLibrary(library);
      await save(library);
      const next = library.decks.find((d) => !d.tour) ?? library.decks[0];
      return { entry: entry.id, cardIds, next: next.name };
    },

    // /trash: what's in it, newest first; anything there longer than the trash keeps it goes now
    async trash() {
      const library = await load();
      if (emptyOldTrash(library)) await save(library);
      return (library.trash ?? []).toReversed().map((entry) => ({ id: entry.id, name: entry.deck.name, cards: entry.cards.length, deletedAt: entry.deletedAt, until: trashedUntil(entry) }));
    },

    // A deck back from the trash (/trash, or u right after deleting it). Like a deck of your own, it takes
    // the tour's place. → { deck, progress, removed }: its name now, the progress to give back to the
    // session, and the tour's cards that went
    async restoreFromTrash(entryId) {
      const library = await load();
      const { deck, entry } = restoreDeck(library, entryId);
      const tour = library.decks.find((d) => d.tour);
      const removed = tour ? removeDeck(library, tour.id) : [];
      await save(library);
      return { deck: deck.name, progress: entry.progress ?? {}, removed };
    },

    // /import: what a file's cards would do to the library now (see planImport); `source` is { text, list }
    // (each deck there already says how many cards it holds: `cards`)
    async previewImport(source, choices) {
      const library = await load();
      const plan = planImport(library, source.text, { ...choices, list: source.list });
      return { ...plan, decks: plan.decks.map((deck) => ({ ...deck, cards: deck.deck ? cardsOf(library, deck.deck.id).length : 0 })) };
    },

    // /import, carried out: a backup first, then the plan made again on the library as it is now (another
    // window may have changed it). `update`: the changed cards take the file's version. → applyImport's
    // result, and whether a backup was taken (none on a library with nothing in it yet)
    async importCards(source, choices, { update = false } = {}) {
      const backedUp = Boolean(await backup("before-import"));
      const library = await load();
      const result = applyImport(library, planImport(library, source.text, { ...choices, list: source.list }), { update, directions: choices.directions });
      await save(library);
      return { ...result, backedUp };
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
export const { allDecks, ownDecks, startDeck, startFirstWords, setDirections, languagesOf, setLanguages, setLearning, existingDeck, existingCard, addCardTo, addCardsTo, updateCardIn, previewImport, importCards, renameDeck, deleteDeck, trash, restoreFromTrash, matchTourLanguage, backupBeforeReset, resetLibrary } = actions;
