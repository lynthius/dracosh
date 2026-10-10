import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");
const { seedLibrary, STARTER_DECK } = await import("../src/starter.js");
const { addCardTo, allDecks, existingCard, ownDecks, startDeck } = await import("../src/manage.js");
const { listBackups } = await import("../src/backup.js");
const { loadWords } = await import("../src/words.js");
const { createSession } = await import("../src/session.js");
const { DEFAULTS } = await import("../src/settings.js");

test("with only the tour there is no deck to add to yet", async () => {
  const library = await loadLibrary();
  seedLibrary(library);
  await saveLibrary(library);
  assert.deepEqual(await ownDecks(), []);
});

test("your first deck replaces the tour, after a backup, and drops the tour's progress", async () => {
  const tourIds = (await loadLibrary()).cards.map((c) => c.id);
  const state = { items: Object.fromEntries(tourIds.map((id) => [`${id}:en-pl`, { box: 1 }])), newToday: { date: "", count: 0 } };

  const { deck, removed } = await startDeck({ name: "Spanish", bothWays: true });
  assert.deepEqual(removed.sort(), [...tourIds].sort());
  const library = await loadLibrary();
  assert.deepEqual(library.decks.map((d) => d.name), ["Spanish"]);
  assert.equal(library.cards.length, 0);
  assert.equal(deck.directions, "both");
  assert.ok((await listBackups()).some((b) => b.reason === "before-delete" && b.cards === tourIds.length));

  const session = createSession({ loadWords: () => loadWords(), state, getSettings: () => DEFAULTS, save: async () => {} });
  state.accepted = { [`${tourIds[0]}:en-pl`]: ["dog"] };
  await session.forget(removed);
  assert.deepEqual(state.items, {});
  assert.deepEqual(state.accepted, {}, "answers accepted on tour cards go too");
  await assert.rejects(session.next(), (err) => err.empty && !err.tour, "an empty deck of your own is a state, not a crash");
  assert.equal(seedLibrary(await loadLibrary()), false, "the tour doesn't come back");
});

test("cards go into your deck, and a front that's already there is caught", async () => {
  const { card } = await addCardTo("Spanish", { front: "gato", back: ["cat", "kitty"], example: "" });
  assert.ok(card);
  assert.equal((await existingCard("Spanish", "Gato")).id, card.id);
  assert.equal(await existingCard("Spanish", "perro"), null);
  assert.ok((await addCardTo("Spanish", { front: "gato", back: ["cat"] })).duplicate);
  assert.equal((await loadWords()).words.length, 1);
});

test("more decks can follow, and each one lists its cards", async () => {
  const { removed } = await startDeck({ name: "Biology", bothWays: false });
  assert.deepEqual(removed, [], "no tour left to remove");
  await addCardTo("Biology", { front: "What do mitochondria make?", back: ["energy", "ATP"] });
  assert.deepEqual(await ownDecks(), [{ name: "Spanish", cards: 1, bothWays: true }, { name: "Biology", cards: 1, bothWays: false }]);
  assert.deepEqual(await allDecks(), [{ name: "Spanish", cards: 1, tour: false }, { name: "Biology", cards: 1, tour: false }]);
});

test("a reset is backed up first; everything brings the tour back", async () => {
  const { backupBeforeReset, resetLibrary } = await import("../src/manage.js");
  await backupBeforeReset();
  assert.ok((await listBackups()).some((b) => b.reason === "before-reset" && b.decks === 2));
  assert.equal(await resetLibrary(), STARTER_DECK);
  const library = await loadLibrary();
  assert.deepEqual(library.decks.map((d) => d.name), [STARTER_DECK]);
  assert.ok(library.decks[0].tour);
});

test("a deck name already taken is caught up front, the tour's name is free, and names stay short", async () => {
  const { existingDeck } = await import("../src/manage.js");
  const { MAX_DECK_NAME } = await import("../src/library.js");
  assert.equal(await existingDeck(STARTER_DECK), null, "the tour is about to make room");
  await startDeck({ name: STARTER_DECK.toUpperCase() }); // replaces the tour, same name in other case
  await startDeck({ name: "Biology" });
  assert.equal((await existingDeck("  biology ")).name, "Biology");
  assert.equal(await existingDeck("Chemistry"), null);
  await assert.rejects(startDeck({ name: "x".repeat(MAX_DECK_NAME + 1) }), /characters or fewer/);
  await assert.rejects(startDeck({ name: "BIOLOGY" }), /already a deck called "Biology"/);
});

test("nothing you'd have to type in the quiz may start with /", async () => {
  await startDeck({ name: "Unix", bothWays: false });
  await assert.rejects(addCardTo("Unix", { front: "the root", back: ["/"] }), /can't start with \//);
  assert.ok((await addCardTo("Unix", { front: "/etc", back: ["config"] })).card, "a front is only shown in a one-way deck");
  await startDeck({ name: "Both", bothWays: true });
  await assert.rejects(addCardTo("Both", { front: "/etc", back: ["config"] }), /can't start with \//);
});
