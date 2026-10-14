import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");
const { seedLibrary, STARTER_DECK } = await import("../src/starter.js");
const { addCardTo, addCardsTo, allDecks, existingCard, languagesOf, ownDecks, setDirections, setLanguages, startDeck, updateCardIn } = await import("../src/manage.js");
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

  const { deck, removed } = await startDeck({ name: "Spanish" });
  assert.deepEqual(removed.sort(), [...tourIds].sort());
  const library = await loadLibrary();
  assert.deepEqual(library.decks.map((d) => d.name), ["Spanish"]);
  assert.equal(library.cards.length, 0);
  assert.equal(deck.directions, "forward", "front → back until the first card says otherwise");
  await setDirections("Spanish", "both");
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
  const { removed } = await startDeck({ name: "Biology" });
  assert.deepEqual(removed, [], "no tour left to remove");
  await addCardTo("Biology", { front: "What do mitochondria make?", back: ["energy", "ATP"] });
  assert.deepEqual(await ownDecks(), [{ name: "Spanish", cards: 1, directions: "both" }, { name: "Biology", cards: 1, directions: "forward" }]);
  assert.deepEqual(
    (await allDecks()).map(({ name, cards, tour, sample }) => ({ name, cards, tour, sample })),
    [{ name: "Spanish", cards: 1, tour: false, sample: { front: "gato", back: ["cat", "kitty"] } }, { name: "Biology", cards: 1, tour: false, sample: { front: "What do mitochondria make?", back: ["energy", "ATP"] } }]
  );
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
  await startDeck({ name: "Unix" });
  await assert.rejects(addCardTo("Unix", { front: "the root", back: ["/"] }), /can't start with \//);
  assert.ok((await addCardTo("Unix", { front: "/etc", back: ["config"] })).card, "a front is only shown in a one-way deck");
  await startDeck({ name: "Both" });
  await setDirections("Both", "both");
  await assert.rejects(addCardTo("Both", { front: "/etc", back: ["config"] }), /can't start with \//);
});

test("a deck asked back → front shows the back and wants the front; only the front can't start with /", async () => {
  await startDeck({ name: "Terms" });
  await setDirections("Terms", "backward");
  await assert.rejects(addCardTo("Terms", { front: "/root", back: ["the top folder"] }), /can't start with \//);
  assert.ok((await addCardTo("Terms", { front: "root", back: ["/ is the top folder, above all others"] })).card);
  const session = createSession({ loadWords: () => loadWords("Terms"), state: { items: {}, newToday: { date: "", count: 0 } }, getSettings: () => DEFAULTS, save: async () => {} });
  const question = await session.next();
  assert.equal(question.prompt, "/ is the top folder, above all others");
  assert.deepEqual(question.expected, ["root"]);
});

test("a pasted list goes in at once: duplicates and '/' answers are skipped, the rest saved together", async () => {
  await startDeck({ name: "Pasted" });
  const { added, duplicates } = await addCardsTo("Pasted", [
    { front: "pies", back: ["dog"] },
    { front: "kot", back: ["cat"] },
    { front: "Pies", back: ["hound"] },
    { front: "ścieżka", back: ["/path"] },
    { front: "I {{look forward}} to it", back: [], cloze: true }
  ]);
  assert.deepEqual(added.map((card) => card.front), ["pies", "kot", "I {{look forward}} to it"]);
  assert.equal(duplicates.length, 2);
});

test("a card fixed right after adding keeps its id, so nothing is lost", async () => {
  const { card } = await addCardTo("Pasted", { front: "dom", back: ["hose"] });
  const { card: fixed, staleKeys } = await updateCardIn("Pasted", card.id, { front: "dom", back: ["house", "home"], example: "" });
  assert.equal(fixed.id, card.id);
  assert.deepEqual(staleKeys, []);
  assert.deepEqual(fixed.back, ["house", "home"]);
  await assert.rejects(updateCardIn("Pasted", card.id, { front: "kot", back: ["cat"] }), /already/);
});

test("fixing a card into another shape names the progress it no longer has", async () => {
  const { card } = await addCardTo("Pasted", { front: "I {{look}} at {{it}}", back: [], cloze: true });
  const { staleKeys } = await updateCardIn("Pasted", card.id, { front: "I {{look}} at it", back: [], cloze: true });
  assert.deepEqual(staleKeys, [`${card.id}:c2`]);
  const plain = await updateCardIn("Pasted", card.id, { front: "look", back: ["patrzeć"], cloze: false });
  assert.deepEqual(plain.staleKeys, [`${card.id}:c1`]);
});

test("a switch that would make a '/' text something to type is refused; otherwise the deck's cards come back", async () => {
  await startDeck({ name: "Paths" });
  await addCardTo("Paths", { front: "/usr", back: ["programs"] });
  await assert.rejects(setDirections("Paths", "backward"), /\/usr/);
  const { cardIds } = await setDirections("Paths", "forward");
  assert.equal(cardIds.length, 1);
});

test("a deck's languages are guessed from its cards until you set them; null goes back to guessing", async () => {
  await startDeck({ name: "Niemiecki" });
  await addCardsTo("Niemiecki", [{ front: "die Katze", back: ["kot"] }, { front: "der Hund", back: ["pies"] }, { front: "die Straße", back: ["ulica"] }]);
  assert.deepEqual(await languagesOf("Niemiecki"), { front: "de", back: "und", guessed: true }, "the backs show no sign of a language yet");
  assert.deepEqual(await setLanguages("Niemiecki", { front: "de", back: "pl" }), { front: "de", back: "pl", guessed: false });
  assert.deepEqual((await allDecks()).find((d) => d.name === "Niemiecki").languages, { front: "de", back: "pl", guessed: false });
  assert.equal((await loadWords("Niemiecki")).deck.languages.back, "pl", "the quiz sees them too");
  await assert.rejects(setLanguages("Niemiecki", { front: "German", back: "pl" }));
  await assert.rejects(setLanguages("Niemiecki", { front: ["de"], back: "pl" }), "only a code, never something that reads like one");
  assert.deepEqual(await setLanguages("Niemiecki", { front: "DE", back: " pl " }), { front: "de", back: "pl", guessed: false });
  assert.equal((await setLanguages("Niemiecki", null)).guessed, true);
});
