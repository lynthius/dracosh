import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");
const { loadWords } = await import("../src/words.js");
const { seedLibrary, STARTER_DECK } = await import("../src/starter.js");
const { addCard, cardsOf, createDeck } = await import("../src/library.js");
const { createSession } = await import("../src/session.js");
const { DEFAULTS } = await import("../src/settings.js");

test("a fresh library gets the Getting started deck, once", async () => {
  const library = await loadLibrary();
  assert.equal(seedLibrary(library), true);
  assert.equal(seedLibrary(library), false, "never twice, and never into a library that has decks");
  await saveLibrary(library);
  const { words, deck } = await loadWords();
  assert.equal(deck.name, STARTER_DECK);
  assert.ok(words.length >= 8);
  assert.ok(words.every((w) => !w.translations.some((t) => t.startsWith("/"))), "no answer starts with the command key");
});

test("an older copy of the tour is replaced by the current one, once", async () => {
  const { emptyLibrary } = await import("../src/library.js");
  const library = emptyLibrary();
  const old = createDeck(library, { name: STARTER_DECK, type: "qa", languages: null, directions: "forward" });
  addCard(library, old.id, { front: "What wakes a sleeping dragon?", back: ["any key"] });
  const mine = createDeck(library, { name: "Spanish", languages: { front: "es", back: "en" } });
  addCard(library, mine.id, { front: "gato", back: ["cat"] });

  assert.equal(seedLibrary(library), true);
  assert.equal(seedLibrary(library), false);
  assert.equal(library.decks.length, 2, "no second tour");
  const tour = cardsOf(library, old.id);
  assert.ok(tour.length >= 8 && !tour.some((c) => c.front.startsWith("What wakes")));
  assert.equal(cardsOf(library, mine.id).length, 1, "your own decks stay as they are");
});

test("an older tour replaced in another language takes that language's name too", async () => {
  const { emptyLibrary } = await import("../src/library.js");
  const { setLanguage } = await import("../src/i18n.js");
  const library = emptyLibrary();
  const old = createDeck(library, { name: STARTER_DECK, type: "qa", languages: null, directions: "forward" });
  addCard(library, old.id, { front: "What wakes a sleeping dragon?", back: ["any key"] });
  try {
    setLanguage("pl");
    assert.equal(seedLibrary(library), true);
    assert.equal(old.name, "Pierwsze kroki");
    assert.equal(seedLibrary(library), false);
  } finally {
    setLanguage("en");
  }
});

test("the tour follows the app's language and keeps what's already done", async () => {
  const { emptyLibrary } = await import("../src/library.js");
  const { setLanguage } = await import("../src/i18n.js");
  const library = emptyLibrary();
  seedLibrary(library);
  const ids = library.cards.map((card) => card.id);
  try {
    setLanguage("pl");
    assert.equal(seedLibrary(library), true);
    assert.equal(seedLibrary(library), false, "once per language");
    assert.equal(library.decks[0].name, "Pierwsze kroki");
    assert.deepEqual(library.cards.map((card) => card.id), ids, "same cards, so their progress stays");
    assert.match(library.cards[0].front, /`cześć`/);
    assert.deepEqual(library.cards[0].back, ["cześć"]);

    setLanguage("en");
    const mine = createDeck(library, { name: "Pierwsze kroki 2", languages: null });
    mine.name = "Getting started"; // a deck of yours took the tour's English name meanwhile
    assert.equal(seedLibrary(library), true);
    assert.equal(library.decks[0].name, "Pierwsze kroki", "the tour keeps its name rather than clash with yours");
    assert.match(library.cards[0].front, /`hello`/);
  } finally {
    setLanguage("en");
  }
});

test("decks are picked by name, and a wrong name lists the real ones", async () => {
  const library = await loadLibrary();
  const spanish = createDeck(library, { name: "Spanish", languages: { front: "es", back: "en" } });
  addCard(library, spanish.id, { front: "gato", back: ["cat"] });
  await saveLibrary(library);
  assert.equal((await loadWords("spanish")).deck.name, "Spanish");
  await assert.rejects(loadWords("French"), /no deck called "French".*"Getting started", "Spanish"/);
});

test("cards added to the library show up at the next question without a restart", async () => {
  const library = await loadLibrary();
  const before = (await loadWords("Spanish")).words.length;
  addCard(library, library.decks.find((d) => d.name === "Spanish").id, { front: "perro", back: ["dog"] });
  await saveLibrary(library);
  assert.equal((await loadWords("Spanish")).words.length, before + 1);
});

const sessionOn = (deckName) =>
  createSession({ loadWords: () => loadWords(deckName), state: { items: {}, newToday: { date: "", count: 0 } }, getSettings: () => DEFAULTS, save: async () => {} });

test("a one-way deck is never asked in reverse and shows its name on the card", async () => {
  const session = sessionOn(STARTER_DECK);
  for (let i = 0; i < 20; i++) {
    const q = await session.next();
    assert.equal(q.direction, "en-pl");
    assert.equal(q.label, STARTER_DECK);
  }
});

test("the tour is asked once, in order, and every card says what to type", async () => {
  const { words } = await loadWords(STARTER_DECK);
  const session = sessionOn(STARTER_DECK);
  for (const word of words) {
    const q = await session.next();
    assert.equal(q.word.noteId, word.noteId);
    const onPurpose = word.word.includes("wrong on purpose");
    const named = word.translations.some((t) => word.word.toLowerCase().includes(t.toLowerCase()));
    assert.equal(named, !onPurpose, `"${word.word}" names its answer, unless you're meant to miss it`);
    await session.answer(q, onPurpose ? "dog" : q.expected[0]);
  }
  await assert.rejects(session.next(), (err) => err.empty && err.tour, "once through, the tour is done: nothing comes back as a review");
});

test("each question knows the language its answer is in, for that language's spellings", async () => {
  const session = sessionOn("Spanish");
  const seen = new Map();
  for (let i = 0; i < 30; i++) {
    const q = await session.next();
    seen.set(q.direction, q.answerLanguage);
  }
  assert.deepEqual(Object.fromEntries(seen), { "en-pl": "en", "pl-en": "es" });
});

test("a card is labelled with its deck's name, whichever way it's asked", async () => {
  const session = sessionOn("Spanish");
  const labels = new Set();
  for (let i = 0; i < 30; i++) labels.add((await session.next()).label);
  assert.deepEqual([...labels], ["Spanish"]);
});

test("the tour doesn't use up the daily cap on new cards", async () => {
  const { newToday } = await import("../src/scheduler.js");
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: () => loadWords(STARTER_DECK), state, getSettings: () => DEFAULTS, save: async () => {} });
  const q = await session.next();
  await session.answer(q, q.expected[0]);
  assert.equal(Object.keys(state.items).length, 1);
  assert.equal(newToday(state, Date.now()), 0);
});

test("decks practised together: their cards mixed, each asked as its own deck asks", async () => {
  const { emptyLibrary } = await import("../src/library.js");
  const library = emptyLibrary();
  seedLibrary(library);
  const de = createDeck(library, { name: "German", languages: { front: "de", back: "pl" }, directions: "forward" });
  const es = createDeck(library, { name: "Spanish", languages: { front: "es", back: "pl" }, directions: "both" });
  addCard(library, de.id, { front: "der Hund", back: ["pies"] });
  addCard(library, es.id, { front: "el gato", back: ["kot"] });
  await saveLibrary(library);

  const { words, deck } = await loadWords(["German", "spanish", "Gone"]);
  assert.deepEqual(deck.mixed, ["German", "Spanish"], "a deck that's gone is left out");
  assert.deepEqual(words.map((w) => [w.word, w.deck.name, w.directions]), [["der Hund", "German", ["en-pl"]], ["el gato", "Spanish", ["en-pl", "pl-en"]]]);
  assert.deepEqual((await loadWords("all")).deck.mixed, ["German", "Spanish"], "all of yours, not the tour");
  assert.equal((await loadWords(["German", "Gone"])).deck.name, "German", "one left: that deck alone");

  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: () => loadWords(["German", "Spanish"]), state, getSettings: () => DEFAULTS, save: async () => {} });
  const seen = new Map();
  for (let i = 0; i < 6; i++) {
    const q = await session.next().catch((err) => (err.empty ? null : Promise.reject(err)));
    if (!q) break;
    seen.set(q.word.word, q);
    await session.answer(q, q.expected[0]);
  }
  assert.equal(seen.get("der Hund").label, "German", "the card shows its own deck");
  assert.equal(seen.get("der Hund").learningLanguage, "de");
  assert.equal(seen.get("el gato").answerLanguage === "pl" || seen.get("el gato").answerLanguage === "es", true);
});
