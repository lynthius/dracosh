import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addCard, cardsOf, createDeck, emptyLibrary, findDeck, toWords, updateCard, upgradeLibrary } from "../src/library.js";
import { itemKey } from "../src/scheduler.js";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadLibrary, saveLibrary } = await import("../src/store.js");

const withDeck = (options = {}) => {
  const library = emptyLibrary();
  const deck = createDeck(library, { name: "Spanish", ...options });
  return { library, deck };
};

test("a deck gets sensible defaults per card type", () => {
  const library = emptyLibrary();
  assert.equal(createDeck(library, { name: "Words" }).answerMode, "typed");
  assert.equal(createDeck(library, { name: "Terms", type: "definition" }).answerMode, "typed");
  assert.equal(createDeck(library, { name: "Trivia", type: "qa" }).answerMode, "self");
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
  const again = addCard(library, deck.id, { front: "arbol!", back: ["tree"] });
  assert.equal(again.card, null);
  assert.equal(again.duplicate.front, "Árbol");
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
