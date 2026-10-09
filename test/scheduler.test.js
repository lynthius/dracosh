import assert from "node:assert/strict";
import { test } from "node:test";
import { BOX_INTERVALS_DAYS, describeDue, grade, itemKey, pickNext, RELEARN_DELAY } from "../src/scheduler.js";

const DAY = 86_400_000;
const NOW = new Date("2026-10-09T10:00:00").getTime();
const words = [1, 2, 3].map((noteId) => ({ noteId, word: `w${noteId}`, translations: ["x"], example: "" }));
const emptyState = () => ({ items: {}, newToday: { date: "", count: 0 } });

test("correct answers climb the boxes, a miss resets to box 1 with a short relearn delay", () => {
  let entry = grade(undefined, true, NOW);
  assert.equal(entry.box, 1);
  assert.equal(entry.due, NOW + BOX_INTERVALS_DAYS[0] * DAY);
  entry = grade(entry, true, NOW);
  assert.equal(entry.box, 2);
  assert.equal(entry.due, NOW + BOX_INTERVALS_DAYS[1] * DAY);
  entry = grade(entry, false, NOW);
  assert.equal(entry.box, 1);
  assert.equal(entry.due, NOW + RELEARN_DELAY);
  assert.equal(entry.streak, 0);
});

test("the top box stays at the top", () => {
  let entry;
  for (let i = 0; i < 10; i++) entry = grade(entry, true, NOW);
  assert.equal(entry.box, BOX_INTERVALS_DAYS.length);
});

test("due items come back in random order, not in the order they were first answered", () => {
  const state = emptyState();
  for (const w of words) state.items[itemKey(w.noteId, "en-pl")] = { box: 1, due: NOW - w.noteId * 1000 };
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(pickNext({ words, state, now: NOW, random: Math.random }).word.noteId);
  assert.ok(seen.size >= 3, `expected every due note to show up, got ${[...seen]}`);
});

test("the longer an item is overdue, the likelier it is picked", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW - 10 * DAY }; // weight 4
  state.items[itemKey(2, "en-pl")] = { box: 1, due: NOW }; // weight 1
  const only = words.slice(0, 2);
  const pick = (roll) => pickNext({ words: only, state, now: NOW, directions: ["en-pl"], random: () => roll }).word.noteId;
  assert.equal(pick(0), 1);
  assert.equal(pick(0.79), 1); // the first 4/5 of the range belongs to the overdue item
  assert.equal(pick(0.81), 2);
});

test("new words are mixed in among due reviews", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW - DAY };
  const only = words.slice(0, 2);
  const pick = (roll) => pickNext({ words: only, state, now: NOW, directions: ["en-pl"], random: () => roll });
  assert.equal(pick(0.1).entry, undefined); // below NEW_RATIO → introduces the unseen word 2
  assert.equal(pick(0.9).word.noteId, 1); // otherwise a due review (note 1)
});

test("falls back to unseen items, then to a random soon-due one", () => {
  const state = emptyState();
  assert.ok(pickNext({ words, state, now: NOW }));
  for (const w of words) for (const d of ["en-pl", "pl-en"]) state.items[itemKey(w.noteId, d)] = { box: 2, due: NOW + (w.noteId + (d === "en-pl" ? 0 : 1)) * DAY };
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const next = pickNext({ words, state, now: NOW });
    seen.add(`${next.word.noteId}:${next.direction}`);
  }
  assert.ok(seen.size > 1, "extra practice should not always return the same item");
});

test("a lone due card does not monopolize the quiz when there is other material", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW - DAY }; // the word you keep missing
  state.items[itemKey(2, "en-pl")] = { box: 2, due: NOW + DAY };
  state.items[itemKey(3, "en-pl")] = { box: 3, due: NOW + 2 * DAY };
  const picked = new Set();
  for (let i = 0; i < 100; i++) picked.add(pickNext({ words, state, now: NOW, directions: ["en-pl"] }).word.noteId);
  assert.ok(picked.has(1), "the due card still gets asked");
  assert.ok(picked.size > 1, `other cards must be mixed in, got only ${[...picked]}`);
});

test("respects the daily cap on new items and avoids repeating the last note", () => {
  const state = emptyState();
  state.newToday = { date: new Date(NOW).toLocaleDateString("sv"), count: 20 };
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW + DAY };
  state.items[itemKey(2, "en-pl")] = { box: 1, due: NOW + 2 * DAY };
  const next = pickNext({ words, state, now: NOW, lastNoteId: 1 });
  assert.equal(next.word.noteId, 2); // cap reached → no unseen; note 1 is excluded as last
});

test("describeDue picks a readable unit and never says 24 h", () => {
  const due = (ms) => ({ due: NOW + ms });
  assert.equal(describeDue(due(10 * 60_000), NOW), "10 min");
  assert.equal(describeDue(due(5 * 3_600_000), NOW), "5 h");
  assert.equal(describeDue(due(DAY - 60_000), NOW), "1 d");
  assert.equal(describeDue(due(3 * DAY), NOW), "3 d");
});

test("a correct answer given with a hint counts but does not climb a box", () => {
  const first = grade(undefined, true, NOW, { hinted: true });
  assert.equal(first.box, 1);
  assert.equal(first.correct, 1);
  const climbed = grade({ ...first, box: 3 }, true, NOW);
  assert.equal(climbed.box, 4);
  const hinted = grade({ ...first, box: 3 }, true, NOW, { hinted: true });
  assert.equal(hinted.box, 3);
  assert.equal(hinted.due, NOW + BOX_INTERVALS_DAYS[2] * DAY);
});
