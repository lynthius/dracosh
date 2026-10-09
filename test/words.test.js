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

test("a language deck labels the card with its pair, both ways", async () => {
  const session = sessionOn("Spanish");
  const labels = new Set();
  for (let i = 0; i < 30; i++) labels.add((await session.next()).label);
  assert.deepEqual([...labels].sort(), ["EN → ES", "ES → EN"]);
});
