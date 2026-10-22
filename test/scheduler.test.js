import assert from "node:assert/strict";
import { test } from "node:test";
import { describeDue, fromBox, grade, intervalDays, isMastered, itemKey, nextDueAt, pickNext, Rating, ratingFor, readyAt, RELEARN_DELAY, startOfTomorrow } from "../src/scheduler.js";
import { checkState, upgradeState } from "../src/store.js";

const DAY = 86_400_000;
const NOW = new Date("2026-10-09T10:00:00").getTime();
const words = [1, 2, 3].map((noteId) => ({ noteId, word: `w${noteId}`, translations: ["x"], example: "" }));
const emptyState = () => ({ items: {}, newToday: { date: "", count: 0 } });

test("a new card: right waits two days, a miss comes back in 10 minutes, a hint or a typo in 15", () => {
  const good = grade(undefined, Rating.Good, NOW);
  assert.equal(good.phase, "review");
  assert.equal(good.due, NOW + 2 * DAY);
  assert.deepEqual([good.seen, good.correct, good.wrong, good.streak, good.last], [1, 1, 0, 1, NOW]);
  const again = grade(undefined, Rating.Again, NOW);
  assert.equal(again.phase, "learning");
  assert.equal(again.due, NOW + RELEARN_DELAY);
  assert.deepEqual([again.correct, again.wrong, again.streak], [0, 1, 0]);
  const hard = grade(undefined, Rating.Hard, NOW);
  assert.equal(hard.phase, "learning");
  assert.equal(hard.due, NOW + 15 * 60_000);
  assert.equal(hard.correct, 1, "a hinted answer still counts as right");
});

test("each right answer on time sends the card further off; a miss brings it back in 10 minutes", () => {
  let entry = grade(undefined, Rating.Good, NOW);
  const gaps = [intervalDays(entry)];
  for (let i = 0; i < 4; i++) {
    entry = grade(entry, Rating.Good, entry.due);
    gaps.push(intervalDays(entry));
  }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `growing: ${gaps}`);
  assert.ok(gaps.at(-1) >= 60, `months by the fifth answer: ${gaps}`);
  const missed = grade(entry, Rating.Again, entry.due);
  assert.equal(missed.phase, "relearning");
  assert.equal(missed.due, entry.due + RELEARN_DELAY);
  assert.equal(missed.lapses, 1);
  const back = grade(missed, Rating.Good, missed.due);
  assert.equal(back.phase, "review");
  assert.ok(intervalDays(back) >= 1 && intervalDays(back) < gaps.at(-1), "a shorter wait than before the miss");
});

test("a hint, a typo or an almost is Hard: still a right answer, but a shorter wait than Good", () => {
  assert.equal(ratingFor({ correct: false }), Rating.Again);
  assert.equal(ratingFor({ correct: false, hinted: true }), Rating.Again);
  assert.equal(ratingFor({ correct: true }), Rating.Good);
  assert.equal(ratingFor({ correct: true, hinted: true }), Rating.Hard);
  assert.equal(ratingFor({ correct: true, almost: true }), Rating.Hard);
  const known = grade(grade(undefined, Rating.Good, NOW), Rating.Good, NOW + 2 * DAY);
  const at = known.due;
  const [hard, good] = [grade(known, Rating.Hard, at), grade(known, Rating.Good, at)];
  assert.ok(intervalDays(hard) >= 1 && intervalDays(hard) < intervalDays(good), `${intervalDays(hard)} < ${intervalDays(good)}`);
  assert.equal(hard.streak, known.streak + 1);
});

test("a card is mastered once it waits a month or more", () => {
  const review = { phase: "review", last: NOW };
  assert.equal(isMastered({ ...review, due: NOW + 29 * DAY }), false);
  assert.equal(isMastered({ ...review, due: NOW + 30 * DAY }), true);
  assert.equal(isMastered({ phase: "relearning", last: NOW, due: NOW + 40 * DAY }), false, "a miss takes it back");
});

test("Leitner boxes become FSRS's memory: the box's days are the stability, misses the difficulty, the due date stays", () => {
  const top = fromBox({ box: 5, due: NOW + 10 * DAY, last: NOW - 20 * DAY, seen: 6, correct: 6, wrong: 0, streak: 6 });
  assert.deepEqual({ phase: top.phase, stability: top.stability, due: top.due, last: top.last, seen: top.seen }, { phase: "review", stability: 30, due: NOW + 10 * DAY, last: NOW - 20 * DAY, seen: 6 });
  assert.equal(top.box, 5, "kept, so Dracosh 0.5 can tell a newer file from a damaged one");
  assert.ok(isMastered(top), "the last box stays mastered");
  const shaky = fromBox({ box: 3, due: NOW, last: NOW - 7 * DAY, seen: 8, correct: 4, wrong: 4, streak: 2 });
  assert.equal(shaky.stability, 7);
  assert.ok(shaky.difficulty > top.difficulty, "more misses, harder");
  assert.ok(shaky.difficulty >= 1 && shaky.difficulty <= 10);
  const missed = fromBox({ box: 1, due: NOW + RELEARN_DELAY, last: NOW, seen: 3, correct: 2, wrong: 1, streak: 0 });
  assert.equal(missed.phase, "relearning");
  assert.equal(readyAt(missed), missed.due, "it keeps its minute");
  const next = grade(shaky, Rating.Good, NOW);
  assert.ok(intervalDays(next) > 7, `answered right on time, it waits longer than its box did: ${intervalDays(next)}`);
  const old = fromBox({ box: 2, due: NOW });
  assert.deepEqual([old.seen, old.correct, old.wrong, old.streak, old.last], [0, 0, 0, 0, NOW - 3 * DAY], "fields an early version didn't keep");
});

test("progress from Dracosh 0.5 is upgraded in memory and marked; this version's is left alone", () => {
  const v1 = { version: 1, items: { "a:en-pl": { box: 4, due: NOW, last: NOW - 14 * DAY, seen: 4, correct: 4, wrong: 0, streak: 4 } }, newToday: { date: "", count: 0 } };
  checkState(v1);
  const upgraded = upgradeState(v1);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.upgraded, true);
  assert.equal(JSON.stringify(upgraded).includes("upgraded"), false, "the mark isn't saved");
  assert.equal(upgraded.items["a:en-pl"].stability, 14);
  checkState(upgraded);
  assert.equal(upgradeState(upgraded).upgraded, true, "the same object");
  const fresh = upgradeState({ version: 2, items: {}, newToday: { date: "", count: 0 } });
  assert.equal(fresh.upgraded, undefined);
});

test("progress a newer Dracosh wrote says so, and a card without its schedule is damaged", () => {
  assert.throws(() => checkState({ version: 3, items: { a: { odd: true } } }), /newer/);
  assert.throws(() => checkState({ version: 2, items: { "a:en-pl": { box: 2, due: NOW } } }), (err) => err.damaged);
  assert.throws(() => checkState({ version: 2, items: { "a:en-pl": { phase: "review", due: NOW, last: NOW, seen: 1, difficulty: 3 } } }), (err) => err.damaged);
});

test("due items come back in random order, not in the order they were first answered", () => {
  const state = emptyState();
  for (const w of words) state.items[itemKey(w.noteId, "en-pl")] = { phase: "review", due: NOW - w.noteId * 1000 };
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(pickNext({ words, state, now: NOW, random: Math.random }).word.noteId);
  assert.ok(seen.size >= 3, `expected every due note to show up, got ${[...seen]}`);
});

test("the longer an item is overdue, the likelier it is picked", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { phase: "review", due: NOW - 10 * DAY }; // weight 4
  state.items[itemKey(2, "en-pl")] = { phase: "review", due: NOW }; // weight 1
  const only = words.slice(0, 2);
  const pick = (roll) => pickNext({ words: only, state, now: NOW, directions: ["en-pl"], random: () => roll }).word.noteId;
  assert.equal(pick(0), 1);
  assert.equal(pick(0.79), 1); // the first 4/5 of the range belongs to the overdue item
  assert.equal(pick(0.81), 2);
});

test("new words are mixed in among due reviews", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { phase: "review", due: NOW - DAY };
  const only = words.slice(0, 2);
  const pick = (roll) => pickNext({ words: only, state, now: NOW, directions: ["en-pl"], random: () => roll });
  assert.equal(pick(0.1).entry, undefined); // below NEW_RATIO → introduces the unseen word 2
  assert.equal(pick(0.9).word.noteId, 1); // otherwise a due review (note 1)
});

test("cards are never asked before they're due: with nothing waiting there is nothing to ask", () => {
  const state = emptyState();
  assert.ok(pickNext({ words, state, now: NOW }), "unseen cards are waiting");
  for (const w of words) for (const d of ["en-pl", "pl-en"]) state.items[itemKey(w.noteId, d)] = { phase: "review", due: NOW + (w.noteId + (d === "en-pl" ? 0 : 1)) * DAY };
  assert.equal(pickNext({ words, state, now: NOW }), null);
  assert.equal(nextDueAt({ words, state, now: NOW }), startOfTomorrow(NOW), "the earliest due card, ready from midnight");
});

test("a lone due card is asked even right after itself, when nothing else is waiting", () => {
  const state = emptyState();
  state.items[itemKey(1, "en-pl")] = { phase: "review", due: NOW - DAY }; // the card you keep missing
  state.items[itemKey(2, "en-pl")] = { phase: "review", due: NOW + DAY };
  const next = pickNext({ words: words.slice(0, 2), state, now: NOW, directions: ["en-pl"], lastNoteId: 1 });
  assert.equal(next.word.noteId, 1);
});

test("respects the daily cap on new items and avoids repeating the last note", () => {
  const state = emptyState();
  state.newToday = { date: new Date(NOW).toLocaleDateString("sv"), count: 20 };
  state.items[itemKey(1, "en-pl")] = { phase: "review", due: NOW - DAY };
  state.items[itemKey(2, "en-pl")] = { phase: "review", due: NOW - 2 * DAY };
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

test("a review waits for the whole day it falls due; a card just missed keeps its minute", async () => {
  const evening = new Date(2026, 9, 14, 17, 0).getTime();
  const morning = new Date(2026, 9, 15, 7, 30).getTime();
  const reviewed = { phase: "review", streak: 1, due: evening + 24 * 3_600_000 };
  assert.equal(readyAt(reviewed), new Date(2026, 9, 15).getTime());
  const missed = { phase: "relearning", streak: 0, due: morning + 10 * 60_000 };
  assert.equal(readyAt(missed), missed.due);
  const words = [{ noteId: "a", word: "kot", translations: ["cat"] }];
  const state = { items: { "a:en-pl": reviewed }, newToday: { date: "", count: 0 } };
  assert.ok(pickNext({ words, state, now: morning, directions: ["en-pl"] }), "yesterday's 17:00 card is ready at 7:30");
});

test("the daily limit counts new cards, not each way they're asked", async () => {
  const { pickNext, NEW_PER_DAY } = await import("../src/scheduler.js");
  const { recordAnswer } = await import("../src/store.js");
  const now = new Date(2026, 9, 15, 9).getTime();
  const words = [{ noteId: "a", word: "kot", translations: ["cat"] }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  recordAnswer(state, "a", "en-pl", { phase: "review", streak: 1, due: now + 86_400_000 }, now);
  assert.equal(state.newToday.count, 1);
  recordAnswer(state, "a", "pl-en", { phase: "review", streak: 1, due: now + 86_400_000 }, now);
  assert.equal(state.newToday.count, 1, "the other way round of the same card isn't a new card");
  state.newToday.count = NEW_PER_DAY;
  delete state.items["a:pl-en"];
  assert.ok(pickNext({ words, state, now, directions: ["en-pl", "pl-en"] }), "a started card's other way still comes at the limit");
});

test("a sitting across midnight doesn't ask a card again minutes later; a clock change doesn't shorten a day", async () => {
  const late = new Date(2026, 9, 14, 23, 53).getTime();
  const card = grade(null, Rating.Good, late);
  assert.ok(readyAt(card) >= late + 12 * 3_600_000, "half a day at least");
  const night = new Date(2026, 9, 25, 0, 30).getTime(); // the night clocks go back in Europe
  const learned = grade(null, Rating.Good, night);
  assert.equal(new Date(learned.due).getDate(), 27, "two calendar days later, at the same time");
  assert.equal(new Date(learned.due).getHours(), 0);
});

test("a hint or a typo every time still moves a new or missed card on: the second one in a row counts as Good", () => {
  const first = grade(undefined, Rating.Hard, NOW);
  assert.equal(first.phase, "learning");
  const second = grade(first, Rating.Hard, first.due);
  assert.equal(second.phase, "review", "not another 15 minutes");
  assert.ok(intervalDays(second) >= 1);
  const missed = grade(second, Rating.Again, second.due);
  const hinted = grade(missed, Rating.Hard, missed.due);
  assert.equal(hinted.phase, "relearning", "right after a miss, a hint asks once more");
  assert.equal(grade(hinted, Rating.Hard, hinted.due).phase, "review");
});

test("a clock set back since the last answer doesn't stop a card from being answered", () => {
  const known = grade(grade(undefined, Rating.Good, NOW), Rating.Good, NOW + 2 * DAY);
  const earlier = NOW - 3 * DAY;
  const next = grade(known, Rating.Good, earlier);
  assert.ok(next.due > known.last && Number.isFinite(next.stability));
});

test("odd old progress (hand-edited counts, an answer after the due date) converts to something FSRS can use", () => {
  for (const odd of [{ box: 2, due: NOW, seen: "3", correct: null, last: "2026-10-20" }, { box: 3, due: NOW, last: NOW + DAY, seen: 2, correct: 2, wrong: 0, streak: 2 }, { box: 0, due: NOW }, { box: 9, due: NOW, seen: 1, wrong: 5 }]) {
    const entry = fromBox(odd);
    checkState({ version: 2, items: { "a:en-pl": entry } });
    assert.ok(entry.last <= entry.due);
    const next = grade(entry, Rating.Good, NOW);
    assert.ok(Number.isFinite(next.due) && next.due > NOW, JSON.stringify(odd));
  }
});
