import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession } from "../src/session.js";
import { DEFAULTS } from "../src/settings.js";

const words = [
  { noteId: 1, word: "genuine", translations: ["autentyczny", "szczery"], example: "Her apology felt genuine." },
  { noteId: 2, word: "software", translations: ["oprogramowanie"], example: "" }
];

// a fixed midday clock, so time-of-day badges (night owl, early bird) never sneak into the results
const NOON = new Date("2026-03-04T12:00:00").getTime();

function setup(settings = {}, now = () => NOON) {
  const saves = [];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({
    loadWords: async () => ({ words }),
    state,
    getSettings: () => ({ ...DEFAULTS, ...settings }),
    save: async (s) => saves.push(structuredClone(s)),
    now
  });
  return { session, state, saves };
}

test("asks in both directions with matching expected answers", async () => {
  const { session } = setup();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const q = await session.next();
    seen.add(q.direction);
    if (q.direction === "en-pl") assert.deepEqual(q.expected, q.word.translations);
    else assert.deepEqual(q.expected, [q.word.word]);
  }
  assert.deepEqual([...seen].sort(), ["en-pl", "pl-en"]);
});

test("never asks the same note twice in a row", async () => {
  const { session } = setup();
  let last = null;
  for (let i = 0; i < 30; i++) {
    const q = await session.next();
    assert.notEqual(q.word.noteId, last);
    last = q.word.noteId;
  }
});

test("answer grades, persists and tracks the combo", async () => {
  const { session, state, saves } = setup();
  const q = await session.next();
  const good = await session.answer(q, q.expected[0].toUpperCase());
  assert.equal(good.result, "exact");
  assert.equal(good.combo, 1);
  assert.equal(saves.length, 1);
  assert.equal(Object.values(state.items)[0].box, 1);

  const q2 = await session.next();
  const bad = await session.answer(q2, "zzzzzz");
  assert.equal(bad.result, "wrong");
  assert.deepEqual(session.totals, { asked: 2, correct: 1, combo: 0 });
  assert.equal(session.stats().today.correct, 1);
});

test("reaching the daily goal cheers and starts the streak", async () => {
  const { session } = setup({ dailyGoal: 2 });
  const q1 = await session.next();
  await session.answer(q1, q1.expected[0]);
  const q2 = await session.next();
  const reward = await session.answer(q2, q2.expected[0]);
  assert.ok(reward.cheers.some((c) => c.kind === "goal"));
  assert.equal(session.stats().streak.days, 1);
  assert.ok(session.stats().today.goalMet);
});

test("/correct overrules a wrong answer and remembers it for that card", async () => {
  const { session, state } = setup({ dailyGoal: 1 });
  const q = await session.next();
  const wrong = await session.answer(q, "zupelnie inna odpowiedz");
  assert.equal(wrong.result, "wrong");
  assert.ok(session.canOverrule());
  assert.equal(session.stats().today.correct, 0);

  const fixed = await session.overrule();
  assert.equal(fixed.accepted, "zupelnie inna odpowiedz");
  assert.ok(fixed.cheers.some((c) => c.kind === "goal")); // the corrected answer counts towards the goal
  assert.equal(session.canOverrule(), false);
  assert.deepEqual(session.totals, { asked: 1, correct: 1, combo: 1 });
  assert.equal(session.stats().today.asked, 1);
  assert.equal(session.stats().today.correct, 1);

  const key = Object.keys(state.items)[0];
  assert.equal(state.items[key].box, 1);
  assert.equal(state.items[key].wrong, 0); // as if the answer had been right from the start
  assert.equal(state.items[key].correct, 1);
  assert.deepEqual(state.accepted[key], ["zupelnie inna odpowiedz"]);

  // the same answer on the same card is now accepted straight away
  const again = { ...q };
  const second = await session.answer(again, "ZUPEŁNIE inna odpowiedz");
  assert.equal(second.result, "exact");
});

test("/correct is only possible right after a wrong answer, and only once", async () => {
  const { session } = setup();
  await assert.rejects(() => session.overrule(), /no wrong answer/);
  const q = await session.next();
  await session.answer(q, "zzzzzz");
  await session.overrule();
  await assert.rejects(() => session.overrule(), /no wrong answer/);

  const q2 = await session.next();
  await session.answer(q2, "zzzzzz");
  await session.next(); // a new question closes the window
  assert.equal(session.canOverrule(), false);
});

test("wrong answers are logged for /missed, and /correct removes the entry", async () => {
  const { session } = setup();
  const q = await session.next();
  await session.answer(q, "zzzzzz");
  let missed = session.missed(0);
  assert.equal(missed.items.length, 1);
  assert.equal(missed.items[0].answer, "zzzzzz");
  assert.deepEqual(missed.items[0].expected, q.expected);

  await session.overrule();
  missed = session.missed(0);
  assert.equal(missed.items.length, 0);
});

test("a hinted correct answer does not move the card up", async () => {
  const { session, state } = setup();
  const q = await session.next();
  const result = await session.answer(q, q.expected[0], { hinted: true });
  assert.equal(result.result, "exact");
  assert.equal(result.hinted, true);
  const key = Object.keys(state.items)[0];
  assert.equal(state.items[key].box, 1);

  const q2 = { ...q };
  const again = await session.answer(q2, q.expected[0]);
  assert.equal(again.hinted, false);
  assert.equal(state.items[key].box, 2);
});

test("/pause takes a short break or days off, lists them and turns them off", async () => {
  const { session, state } = setup();
  assert.deepEqual(await session.pause("30m"), { snooze: 1_800_000 });
  assert.match((await session.pause("")).message, /No days off planned/);
  assert.match((await session.pause("7d")).message, /^Days off .* your streak is safe/);
  assert.equal(state.progress.vacations.length, 1);
  assert.match((await session.pause("")).message, /^Days off: /);
  assert.equal(session.stats().restToday, true);
  const off = await session.pause("off");
  assert.equal(off.snooze, "off");
  assert.equal(session.stats().vacation.activeUntil, null);
  await assert.rejects(() => session.pause("30"), /Try \/pause 30m/, "a bare number could be minutes or days");
  await assert.rejects(() => session.pause("whenever"), /Try \/pause/);
});

test("the hatching intro plays only on a brand-new state, and only once", async () => {
  const { session, state, saves } = setup();
  assert.equal(session.isFirstRun(), true);
  await session.markHatched();
  assert.equal(session.isFirstRun(), false);
  assert.equal(saves.at(-1).hatched, true);

  const veteran = setup();
  const q = await veteran.session.next();
  await veteran.session.answer(q, q.expected[0]);
  assert.equal(veteran.session.isFirstRun(), false, "someone who already answered never sees the egg");
  assert.equal(state.hatched, true);
});

test("/badges lights up badges won since the last visit, in the order they were won, once", async () => {
  const { session, state } = setup();
  assert.deepEqual(await session.openBadges(), [], "nothing won yet");
  const q = await session.next();
  await session.answer(q, q.expected[0]); // first correct answer: "Hello!"
  assert.deepEqual(await session.openBadges(), ["hello"]);
  assert.deepEqual(await session.openBadges(), [], "seen now, so it doesn't light up again");
  assert.ok(state.progress.seenBadges.includes("hello"));
});

test("a progress reset starts the game over and keeps what you know; everything clears it all", async () => {
  const { session, state } = setup();
  const q = await session.next();
  await session.answer(q, q.expected[0]);
  assert.ok(state.progress && Object.keys(state.items).length === 1);

  await session.reset("progress");
  assert.equal(state.progress, undefined);
  assert.equal(Object.keys(state.items).length, 1, "the card keeps its box");
  assert.equal(session.stats().badges.filter((b) => b.unlockedOn).length, 0);

  state.hatched = true;
  await session.reset("everything");
  assert.deepEqual(state.items, {});
  assert.equal(session.isFirstRun(), true, "the egg hatches again");
});

test("when everything for today is done, the day counts as the goal; a missed card still comes back today", async () => {
  let clock = NOON;
  const one = [{ noteId: "c1", word: "kot", translations: ["cat"], example: "" }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: one, deck: { name: "Polish", languages: null, directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => clock });

  await session.answer(await session.next(), "dog"); // a miss: back in 10 minutes
  let empty = await session.next().catch((err) => err);
  assert.ok(empty.empty && empty.nextDue > clock && empty.nextDue < clock + 3_600_000, "the missed card is due later today");
  assert.deepEqual(empty.cheers, [], "not done yet");

  clock += 600_000;
  await session.answer(await session.next(), "cat");
  empty = await session.next().catch((err) => err);
  assert.ok(empty.empty && empty.nextDue > clock + 3_600_000, "nothing more today");
  assert.match(empty.cheers.find((c) => c.kind === "goal").text, /All done for today · 1-day streak/);
  assert.equal(session.stats().today.goalMet, true);
  assert.deepEqual((await session.next().catch((err) => err)).cheers, [], "celebrated once");
});
