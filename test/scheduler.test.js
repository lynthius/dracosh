import assert from "node:assert/strict";
import { test } from "node:test";
import { BOX_INTERVALS_DAYS, describeDue, grade, itemKey, nextDueAt, pickNext, RELEARN_DELAY, startOfTomorrow } from "../src/scheduler.js";

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

test("cards are never asked before they're due: with nothing waiting there is nothing to ask", () => {
  const state = emptyState();
  assert.ok(pickNext({ words, state, now: NOW }), "unseen cards are waiting");
  for (const w of words) for (const d of ["en-pl", "pl-en"]) state.items[itemKey(w.noteId, d)] = { box: 2, due: NOW + (w.noteId + (d === "en-pl" ? 0 : 1)) * DAY };
  assert.equal(pickNext({ words, state, now: NOW }), null);
  assert.equal(nextDueAt({ words, state, now: NOW }), NOW + DAY, "the earliest due card");
});

test("a lone due card is asked even right after itself, when nothing else is waiting", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW - DAY }; // the card you keep missing
  state.items[itemKey(2, "en-pl")] = { box: 2, due: NOW + DAY };
  const next = pickNext({ words: words.slice(0, 2), state, now: NOW, directions: ["en-pl"], lastNoteId: 1 });
  assert.equal(next.word.noteId, 1);
});

test("a card answered right after a miss starts over at box 1, back tomorrow", () => {
  const missed = grade(grade(undefined, true, NOW), false, NOW);
  const relearned = grade(missed, true, NOW + 600_000);
  assert.equal(relearned.box, 1);
  assert.equal(relearned.due, NOW + 600_000 + DAY);
  assert.equal(grade(relearned, true, NOW + DAY).box, 2, "after that it climbs as usual");
});

test("respects the daily cap on new items and avoids repeating the last note", () => {
  const state = emptyState();
  state.newToday = { date: new Date(NOW).toLocaleDateString("sv"), count: 20 };
  state.items[itemKey(1, "en-pl")] = { box: 1, due: NOW - DAY };
  state.items[itemKey(2, "en-pl")] = { box: 1, due: NOW - 2 * DAY };
  const next = pickNext({ words, state, now: NOW, directions: ["en-pl"], lastNoteId: 1 });
  assert.equal(next.word.noteId, 2); // cap reached → no unseen; note 1 is excluded as last
  state.items[itemKey(2, "en-pl")].due = NOW + DAY;
  assert.equal(nextDueAt({ words: words.slice(1, 3), state, now: NOW, directions: ["en-pl"] }), startOfTomorrow(NOW), "only new cards left: tomorrow");
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
