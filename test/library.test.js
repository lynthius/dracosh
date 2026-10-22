import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addCard, cardsOf, createDeck, emptyLibrary, findDeck, setDirections, toWords, updateCard, upgradeLibrary } from "../src/library.js";
import { itemKey } from "../src/scheduler.js";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");

const withDeck = (options = {}) => {
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Spanish", ...options });
  return { library, deck };
};

test("a deck is asked one of three ways, and changing it keeps the progress of every direction", () => {
  const library = emptyLibrary();
  assert.equal(createDeck(library, { name: "Words" }).directions, "both");
  const deck = createDeck(library, { name: "Terms", directions: "backward" });
  assert.throws(() => createDeck(library, { name: "Odd", directions: "sideways" }), /Unknown direction/);
  assert.equal(setDirections(library, deck.id, "forward").directions, "forward");
  assert.throws(() => setDirections(library, deck.id, "up"), /Unknown direction/);
});

test("a cloze card needs a gap, not a back, and is asked one gap at a time", () => {
  const { library, deck } = withDeck();
  const { card } = addCard(library, deck.id, { front: "I {{look forward}} to {{it}}", back: [], cloze: true });
  assert.equal(card.cloze, true);
  assert.throws(() => addCard(library, deck.id, { front: "no gaps here", back: [], cloze: true }), /at least one answer/);
  const [word] = toWords([card]);
  assert.deepEqual([word.cloze, word.directions], [["look forward", "it"], ["c1", "c2"]]);
  assert.equal(upgradeLibrary(structuredClone(library)).cards.length, 1, "a saved cloze card loads again");
  // fixing it into a plain card needs a back again
  assert.throws(() => updateCard(library, card.id, { front: "plain now", cloze: false }), /at least one answer/);
  assert.equal(updateCard(library, card.id, { front: "plain now", back: ["ok"], cloze: false }).cloze, undefined);
});

test("deck names are required and unique, ignoring case", () => {
  const { library } = withDeck();
  assert.throws(() => createDeck(library, { name: "  " }), /needs a name/);
  assert.throws(() => createDeck(library, { name: "spanish" }), /already a deck/);
  assert.throws(() => createDeck(library, { name: "X", type: "poem" }), /Unknown card type/);
});

test("decks are found by id or by name", () => {
  const { library, deck } = withDeck();
  assert.equal(findDeck(library, deck.id), deck);
  assert.equal(findDeck(library, " SPANISH "), deck);
  assert.equal(findDeck(library, "French"), null);
});

test("cards are trimmed, answers deduplicated, and need a front and a back", () => {
  const { library, deck } = withDeck();
  const { card } = addCard(library, deck.id, { front: "  gato ", back: ["cat", " cat", "", "tomcat"], example: " El gato duerme. " });
  assert.equal(card.front, "gato");
  assert.deepEqual(card.back, ["cat", "tomcat"]);
  assert.equal(card.example, "El gato duerme.");
  assert.match(card.id, /^c/);
  assert.throws(() => addCard(library, deck.id, { front: "", back: ["x"] }), /needs a front/);
  assert.throws(() => addCard(library, deck.id, { front: "perro", back: [] }), /at least one answer/);
  assert.throws(() => addCard(library, "nope", { front: "a", back: ["b"] }), /doesn't exist/);
});

test("a duplicate front in the same deck is reported, not added", () => {
  const { library, deck } = withDeck();
  addCard(library, deck.id, { front: "Árbol", back: ["tree"] });
  const again = addCard(library, deck.id, { front: "árbol!", back: ["tree"] });
  assert.equal(again.card, null, "letter case and punctuation don't make another word");
  assert.equal(again.duplicate.front, "Árbol");
  addCard(library, deck.id, { front: "el", back: ["the"] });
  assert.ok(addCard(library, deck.id, { front: "él", back: ["he"] }).card, "an accent does: él isn't el");
  const other = createDeck(library, { name: "Spanish 2" });
  assert.ok(addCard(library, other.id, { front: "árbol", back: ["tree"] }).card, "another deck may have the same word");
});

test("cards from Anki keep the note id, so 0.1.0 progress keys still match", () => {
  const { library, deck } = withDeck();
  const { card } = addCard(library, deck.id, { id: 1712345678901, front: "genuine", back: ["autentyczny"] });
  assert.equal(card.id, "1712345678901");
  assert.equal(itemKey(card.id, "en-pl"), itemKey(1712345678901, "en-pl"));
  assert.throws(() => addCard(library, deck.id, { id: 1712345678901, front: "other", back: ["x"] }), /already exists/);
});

test("updating a card validates and refuses to create a duplicate", () => {
  const { library, deck } = withDeck();
  const { card } = addCard(library, deck.id, { front: "casa", back: ["house"], now: 1 });
  addCard(library, deck.id, { front: "perro", back: ["dog"] });
  updateCard(library, card.id, { back: ["house", "home"], example: "Mi casa." }, 2);
  assert.deepEqual(card.back, ["house", "home"]);
  assert.equal(card.updated, 2);
  assert.throws(() => updateCard(library, card.id, { front: "Perro" }), /already in this deck/);
  assert.throws(() => updateCard(library, "nope", { front: "x" }), /doesn't exist/);
});

test("cards map to the quiz's word shape", () => {
  const { library, deck } = withDeck();
  addCard(library, deck.id, { front: "gato", back: ["cat"], example: "El gato." });
  assert.deepEqual(toWords(cardsOf(library, deck.id)).map(({ noteId, ...rest }) => rest), [{ word: "gato", translations: ["cat"], example: "El gato." }]);
});

test("a library from a newer Dracosh is refused instead of being overwritten", () => {
  assert.deepEqual(upgradeLibrary(undefined), emptyLibrary(), "no file yet");
  assert.throws(() => upgradeLibrary({ version: 99, decks: [], cards: [] }), /newer version/);
});

test("a library that isn't one is reported as damaged, never treated as empty", () => {
  for (const raw of [null, [], "x", { decks: "x" }, { decks: [{ id: "d1" }] }, { decks: [], cards: [{ id: "c1", deckId: "d1", front: 5, back: ["x"] }] }, { decks: [], cards: [{ id: "c1", deckId: "d1", front: "kot" }] }]) {
    assert.throws(() => upgradeLibrary(raw), (err) => err.damaged, JSON.stringify(raw));
  }
});

test("the library round-trips through disk", async () => {
  assert.deepEqual(await loadLibrary(), emptyLibrary(), "no file yet means an empty library");
  const { library, deck } = withDeck();
  addCard(library, deck.id, { front: "gato", back: ["cat"] });
  await saveLibrary(library);
  assert.deepEqual(await loadLibrary(), library);
});

test("languages edited into the file by hand are tidied or guessed again, never a damaged library", async () => {
  const { upgradeLibrary } = await import("../src/library.js");
  const deck = (languages) => ({ id: "d1", name: "X", languages });
  const read = (languages) => upgradeLibrary({ version: 2, decks: [deck(languages)], cards: [] }).decks[0].languages;
  assert.deepEqual(read({ front: "EN", back: "pt-BR" }), { front: "en", back: "pt" });
  assert.equal(read({ front: "english", back: "pl" }), null);
});

test("languages that aren't a pair at all are guessed again, never a damaged library", async () => {
  const { upgradeLibrary } = await import("../src/library.js");
  for (const languages of [{ front: "pl", back: 5 }, { front: "pl" }, { front: "pl", back: "" }, "pl-de"]) {
    assert.equal(upgradeLibrary({ version: 2, decks: [{ id: "d1", name: "X", languages }], cards: [] }).decks[0].languages, null);
  }
});

test("a deleted deck waits in the trash with its cards and progress, and comes back whole", async () => {
  const { addCard, createDeck, emptyLibrary, emptyOldTrash, removeDeck, renameDeck, restoreDeck, trashCards, trashDeck, upgradeLibrary, TRASH_DAYS } = await import("../src/library.js");
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Spanish" });
  const { card } = addCard(library, deck.id, { front: "perro", back: ["dog"] });
  const progress = { items: { [`${card.id}:en-pl`]: { due: 1 } } };
  const entry = trashDeck(library, deck.id, { progress, now: 1000 });
  assert.deepEqual([library.decks.length, library.cards.length, library.trash.length], [0, 0, 1]);
  const saved = upgradeLibrary(JSON.parse(JSON.stringify(library))).trash;
  assert.deepEqual([saved[0].id, saved[0].cards, saved[0].progress.items], [entry.id, library.trash[0].cards, progress.items], "the trash is saved with the library");
  const odd = upgradeLibrary({ ...JSON.parse(JSON.stringify(library)), trash: [{ ...library.trash[0], progress: { items: [1], dormant: "abc" } }] }).trash[0].progress;
  assert.deepEqual(odd, { items: {}, accepted: {}, dormant: [] }, "progress edited into something odd comes back as none");

  createDeck(library, { name: "spanish" });
  const { deck: back, entry: from } = restoreDeck(library, entry.id);
  assert.equal(back.name, "Spanish 2", "a deck with its name now: numbered");
  assert.equal(back.id, deck.id);
  assert.deepEqual(library.cards.map((c) => c.id), [card.id]);
  assert.deepEqual(from.progress, progress);
  assert.equal("trash" in library, false);
  assert.throws(() => restoreDeck(library, entry.id), /isn't in the trash/);
  const card2 = addCard(library, back.id, { front: "gato", back: ["cat"] }).card;
  const cardsEntry = trashCards(library, [card2.id]);
  const deckEntry = trashDeck(library, back.id);
  restoreDeck(library, cardsEntry.id); // its deck is gone: it comes back in one of its own, under the old id
  const again = restoreDeck(library, deckEntry.id).deck;
  assert.notEqual(again.id, back.id, "the old id is taken now: a new one");
  assert.ok(library.cards.filter((c) => c.deckId === again.id).length === 1);
  removeDeck(library, again.id);

  trashDeck(library, back.id, { now: 0 });
  assert.equal(emptyOldTrash(library, (TRASH_DAYS - 1) * 86_400_000), false);
  assert.equal(emptyOldTrash(library, TRASH_DAYS * 86_400_000), true, "kept for TRASH_DAYS, then gone");
  assert.equal("trash" in library, false);

  const other = library.decks[0];
  assert.throws(() => renameDeck(library, other.id, " "), /needs a name/);
  assert.equal(renameDeck(library, other.id, " Español ").name, "Español");
  createDeck(library, { name: "Verbs" });
  assert.throws(() => renameDeck(library, other.id, "verbs"), /already a deck/);
  assert.equal(renameDeck(library, other.id, "español").name, "español", "its own name in other letters is fine");
});

test("cards move between decks unless the front is there already; deleted cards go back into their deck", async () => {
  const { addCard, createDeck, emptyLibrary, moveCards, removeDeck, restoreDeck, trashCards } = await import("../src/library.js");
  const library = emptyLibrary();
  const a = createDeck(library, { name: "A" });
  const b = createDeck(library, { name: "B" });
  const { card: dog } = addCard(library, a.id, { front: "pies", back: ["dog"] });
  const { card: cat } = addCard(library, a.id, { front: "kot", back: ["cat"] });
  addCard(library, b.id, { front: "Kot!", back: ["cat"] });
  assert.deepEqual(moveCards(library, [dog.id, cat.id], b.id), { moved: [dog.id], duplicates: [cat.id] }, "the same front, punctuation aside, stays");
  assert.equal(dog.deckId, b.id);

  const entry = trashCards(library, [cat.id], { progress: { items: { x: 1 } } });
  assert.equal(library.cards.some((c) => c.id === cat.id), false);
  assert.equal(entry.kind, "cards");
  const back = restoreDeck(library, entry.id);
  assert.deepEqual([back.deck.id, back.skipped], [a.id, 0], "into its own deck");
  assert.equal(library.cards.find((c) => c.id === cat.id).deckId, a.id);

  const again = trashCards(library, [cat.id]);
  addCard(library, a.id, { front: "kot", back: ["kitty"] });
  assert.equal(restoreDeck(library, again.id).skipped, 1, "its front is taken now: it stays in the trash");
  assert.equal(library.trash.length, 1);

  removeDeck(library, a.id);
  const alone = restoreDeck(library, again.id);
  assert.equal(alone.deck.name, "A", "its deck is gone: it comes back in a deck of its own");
  assert.deepEqual(library.cards.filter((c) => c.deckId === alone.deck.id).map((c) => c.id), [cat.id]);
});
