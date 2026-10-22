import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");
const { seedLibrary, STARTER_DECK } = await import("../src/starter.js");
const { addCardTo, addCardsTo, allDecks, existingCard, languagesOf, ownDecks, setDirections, setLanguages, startDeck, startFirstWords, updateCardIn, previewImport, importCards, deleteDeck, restoreFromTrash, renameDeck, trash, cardsIn, deleteCards, mergeDecks } = await import("../src/manage.js");
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

const noHome = ({ home, ...rest }) => rest; // (your own language, from other decks: tested in language.test.js)

test("a deck's languages are guessed from its cards until you set them; null goes back to guessing", async () => {
  await startDeck({ name: "Niemiecki" });
  await addCardsTo("Niemiecki", [{ front: "die Katze", back: ["kot"] }, { front: "der Hund", back: ["pies"] }, { front: "die Straße", back: ["ulica"] }]);
  assert.deepEqual(noHome(await languagesOf("Niemiecki")), { front: "de", back: "und", guessed: true, learning: { side: "front", lang: "de", sure: false } }, "the backs show no sign of a language yet");
  assert.deepEqual(noHome(await setLanguages("Niemiecki", { front: "de", back: "pl" })), { front: "de", back: "pl", guessed: false, learning: { side: "front", lang: "de", sure: true } }, "named after German: you're learning German");
  assert.equal((await setLanguages("Niemiecki", { front: "de", back: "pl", learning: "pl" })).learning.lang, "pl", "unless you say otherwise");
  const listed = (await allDecks()).find((d) => d.name === "Niemiecki");
  assert.deepEqual([listed.languages, listed.learning.lang], [{ front: "de", back: "pl", guessed: false }, "pl"]);
  assert.equal((await loadWords("Niemiecki")).deck.languages.back, "pl", "the quiz sees them too");
  await assert.rejects(setLanguages("Niemiecki", { front: "German", back: "pl" }));
  await assert.rejects(setLanguages("Niemiecki", { front: ["de"], back: "pl" }), "only a code, never something that reads like one");
  assert.deepEqual(noHome(await setLanguages("Niemiecki", { front: "DE", back: " pl " })), { front: "de", back: "pl", guessed: false, learning: { side: "back", lang: "pl", sure: true } });
  assert.equal((await setLanguages("Niemiecki", null)).guessed, true);
});

test("the welcome's first words: a deck for the pair, the new word shown, in place of the tour", async () => {
  const library = await loadLibrary();
  library.decks = [];
  library.cards = [];
  seedLibrary(library);
  await saveLibrary(library);
  const tourIds = library.cards.map((c) => c.id);

  const { deck, removed } = await startFirstWords({ home: "pl", learning: "de" });
  assert.deepEqual(removed.sort(), [...tourIds].sort());
  assert.equal(deck.name, "German: first words");
  const after = await loadLibrary();
  const mine = after.decks.find((d) => d.name === deck.name);
  assert.deepEqual(mine.languages, { front: "de", back: "pl" });
  assert.equal(mine.directions, "forward", "the word you're learning shown, yours typed");
  const cards = after.cards.filter((c) => c.deckId === mine.id);
  assert.equal(cards.length, 30);
  assert.deepEqual(cards.find((c) => c.front === "das Ei").back, ["jajko", "jajo"]);
  assert.equal(after.decks.some((d) => d.tour), false);
  assert.equal((await languagesOf(deck.name)).learning.lang, "de");

  const again = await startFirstWords({ home: "pl", learning: "de" });
  assert.equal(again.deck.id, mine.id, "taken twice: the same deck, not a copy");
  assert.equal((await loadLibrary()).cards.length, 30);

  const own = await loadLibrary();
  own.decks.push({ id: "dmine", name: "Spanish: first words", type: "translation", languages: null, directions: "forward", created: 1 });
  await saveLibrary(own);
  const spanish = await startFirstWords({ home: "pl", learning: "es" });
  assert.equal(spanish.deck.name, "Spanish: first words 2", "a deck of yours with that name stays yours");
  assert.equal((await loadLibrary()).cards.filter((c) => c.deckId === spanish.deck.id).length, 30);
});

test("/import: a preview changes nothing, the import takes a backup and adds to a deck of yours", async () => {
  const before = await loadLibrary();
  const target = before.decks.find((d) => !d.tour);
  const count = before.cards.filter((c) => c.deckId === target.id).length;
  const source = { text: "Stadt = miasto\nHund = pies\n", list: null };
  const choices = { deckName: target.name, directions: {}, split: false };
  const plan = await previewImport(source, choices);
  assert.equal(plan.decks[0].cards, count, "a deck there already says how many cards it has");
  assert.deepEqual(plan.decks[0].items.map((item) => item.kind), ["new", "new"]);
  assert.equal((await loadLibrary()).cards.length, before.cards.length, "a preview saves nothing");

  const backups = (await listBackups()).length;
  const result = await importCards(source, choices);
  assert.equal(result.added, 2);
  assert.equal(result.backedUp, true);
  assert.equal((await listBackups()).length, backups + 1);
  assert.equal((await loadLibrary()).cards.filter((c) => c.deckId === target.id).length, count + 2);
});

test("/decks → Delete: a backup, the deck and its progress into the trash; the last deck leaves the tour", async () => {
  const library = await loadLibrary();
  library.decks = [];
  library.cards = [];
  delete library.trash;
  await saveLibrary(library);
  await startDeck({ name: "Solo" });
  const { card } = await addCardTo("Solo", { front: "kot", back: ["cat"] });
  const done = await deleteDeck("Solo", (ids) => ({ items: { [`${ids[0]}:en-pl`]: { due: 5 } } }));
  assert.deepEqual(done.cardIds, [card.id]);
  assert.equal(done.next, STARTER_DECK, "nothing left: the tour is back");
  const [newest] = await listBackups();
  assert.deepEqual([newest.reason, newest.cards], ["before-delete", 1], "backed up with the deck still in it");
  const [entry] = await trash();
  assert.deepEqual([entry.name, entry.cards], ["Solo", 1]);

  const back = await restoreFromTrash(entry.id);
  assert.equal(back.deck, "Solo");
  assert.deepEqual(back.progress.items, { [`${card.id}:en-pl`]: { due: 5 } });
  assert.ok(back.removed.length > 0, "the tour gives way to it again");
  assert.deepEqual((await loadLibrary()).decks.map((d) => d.name), ["Solo"]);
  assert.deepEqual(await trash(), []);
  assert.equal((await renameDeck("Solo", "Duo")).name, "Duo");
});

test("/decks → Merge: the cards move with their progress, the emptied deck goes to the trash with what was there", async () => {
  await startDeck({ name: "Into" });
  await addCardTo("Into", { front: "dom", back: ["house"] });
  await startDeck({ name: "From" });
  await addCardTo("From", { front: "dom", back: ["home"] });
  await addCardTo("From", { front: "las", back: ["forest"] });
  const done = await mergeDecks("From", "Into", (ids) => ({ items: Object.fromEntries(ids.map((id) => [`${id}:en-pl`, { due: 1 }])) }));
  assert.equal(done.moved.length, 1);
  assert.equal(done.left.length, 1);
  assert.deepEqual((await cardsIn("Into")).map((c) => c.front).sort(), ["dom", "las"]);
  const [entry] = await trash();
  assert.deepEqual([entry.name, entry.cards], ["From", 1]);

  const undone = await restoreFromTrash(entry.id);
  assert.equal(undone.deck, "From");
  assert.deepEqual((await cardsIn("From")).map((c) => c.front).sort(), ["dom", "las"], "undoing a merge takes the moved cards back");
  assert.deepEqual((await cardsIn("Into")).map((c) => c.front), ["dom"]);
  await mergeDecks("From", "Into");

  const [las] = (await cardsIn("Into")).filter((c) => c.front === "las");
  await deleteCards("Into", [las.id]);
  const [cardEntry] = await trash();
  assert.deepEqual([cardEntry.kind, cardEntry.card.front], ["cards", "las"]);
  const back = await restoreFromTrash(cardEntry.id);
  assert.deepEqual([back.kind, back.deck, back.cards], ["cards", "Into", 1]);
});
