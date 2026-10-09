import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, dayKey, weekStart } from "../src/dates.js";
import { applyAnswer, BADGES, calendarMonth, currentStreak, ensureProgress, missedOn, recordMiss, snapshot, stageFor, undoMiss } from "../src/progress.js";

const at = (day, hour = 10) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).getTime();
const freshState = (now) => {
  const state = { items: {}, newToday: { date: "", count: 0 } };
  ensureProgress(state, now);
  return state;
};
const answer = (state, now, opts = {}) => applyAnswer(state, { result: "exact", goal: 1, now, ...opts });

test("date helpers", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(daysBetween("2026-10-09", "2026-10-12"), 3);
  assert.equal(weekStart("2026-10-09"), "2026-10-05"); // Friday → Monday
  assert.equal(weekStart("2026-10-11"), "2026-10-05"); // Sunday
  assert.equal(dayKey(at("2026-10-09")), "2026-10-09");
});

test("the goal is credited once per day and builds a streak across consecutive days", () => {
  const state = freshState(at("2026-10-05"));
  const first = answer(state, at("2026-10-05"));
  assert.ok(first.cheers.some((c) => c.kind === "goal"));
  assert.ok(!answer(state, at("2026-10-05", 11)).cheers.some((c) => c.kind === "goal"));
  answer(state, at("2026-10-06"));
  answer(state, at("2026-10-07"));
  assert.equal(state.progress.streak.count, 3);
  assert.equal(state.progress.streak.best, 3);
});

test("a freeze bridges one missed day, then the streak breaks without one", () => {
  const state = freshState(at("2026-10-05"));
  answer(state, at("2026-10-05"));
  answer(state, at("2026-10-06"));
  assert.equal(state.progress.streak.freezes, 1);
  assert.equal(currentStreak(state.progress, "2026-10-08"), 2); // missed the 7th, freeze covers it
  answer(state, at("2026-10-08"));
  assert.equal(state.progress.streak.count, 3);
  assert.equal(state.progress.streak.freezes, 0);

  assert.equal(currentStreak(state.progress, "2026-10-10"), 0); // missed the 9th, no freeze left
  answer(state, at("2026-10-10"));
  assert.equal(state.progress.streak.count, 1);
  assert.equal(state.progress.streak.best, 3);
});

test("one freeze is granted per new week, capped at two", () => {
  const state = freshState(at("2026-10-05"));
  state.progress.streak.freezes = 0;
  ensureProgress(state, at("2026-10-06"));
  assert.equal(state.progress.streak.freezes, 0); // same week
  ensureProgress(state, at("2026-10-12"));
  assert.equal(state.progress.streak.freezes, 1);
  ensureProgress(state, at("2026-10-19"));
  ensureProgress(state, at("2026-10-26"));
  assert.equal(state.progress.streak.freezes, 2);
});

test("badges unlock once and are announced", () => {
  const state = freshState(at("2026-10-05"));
  const announced = [];
  for (let i = 0; i < 12; i++) {
    announced.push(...answer(state, at("2026-10-05"), { goal: 99 }).cheers.filter((c) => c.kind === "badge"));
  }
  assert.ok(state.progress.badges["first-steps"]);
  assert.equal(announced.filter((c) => /First steps/.test(c.text)).length, 1);
  assert.equal(announced.length, new Set(announced.map((c) => c.text)).size); // nothing announced twice
});

test("a marathon day unlocks its badge", () => {
  const state = freshState(at("2026-10-05"));
  let badges = [];
  for (let i = 0; i < 30; i++) badges = badges.concat(answer(state, at("2026-10-05"), { goal: 99 }).cheers.filter((c) => /Marathon/.test(c.text)));
  assert.equal(badges.length, 1);
});

test("snapshot flags a streak at risk late in the day", () => {
  const state = freshState(at("2026-10-05"));
  answer(state, at("2026-10-05"));
  assert.equal(snapshot(state, { goal: 1, now: at("2026-10-06", 20) }).streak.atRisk, true);
  assert.equal(snapshot(state, { goal: 1, now: at("2026-10-06", 9) }).streak.atRisk, false);
  assert.equal(snapshot(state, { goal: 1, now: at("2026-10-05", 20) }).streak.atRisk, false); // goal already met
});


const badgeIds = (cheers) => cheers.filter((c) => c.kind === "badge").map((c) => c.text);

test("there are plenty of badges, all with unique ids", () => {
  assert.ok(BADGES.length >= 25);
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
});

test("the very first correct answer says hello", () => {
  const state = freshState(at("2026-10-05"));
  assert.ok(badgeIds(answer(state, at("2026-10-05"), { goal: 99 }).cheers).some((t) => /Hello!/.test(t)));
});

test("time-of-day badges", () => {
  const early = freshState(at("2026-10-05", 6));
  assert.ok(badgeIds(answer(early, at("2026-10-05", 6), { goal: 99 }).cheers).some((t) => /Early bird/.test(t)));
  const late = freshState(at("2026-10-05", 23));
  assert.ok(badgeIds(answer(late, at("2026-10-05", 23), { goal: 99 }).cheers).some((t) => /Night owl/.test(t)));
  const noon = freshState(at("2026-10-05", 12));
  const noonBadges = badgeIds(answer(noon, at("2026-10-05", 12), { goal: 99 }).cheers);
  assert.ok(!noonBadges.some((t) => /Early bird|Night owl/.test(t)));
});

test("welcome back after a week away", () => {
  const state = freshState(at("2026-10-05"));
  answer(state, at("2026-10-05"), { goal: 99 });
  assert.ok(!badgeIds(answer(state, at("2026-10-08"), { goal: 99 }).cheers).some((t) => /Welcome back/.test(t)));
  assert.ok(badgeIds(answer(state, at("2026-10-16"), { goal: 99 }).cheers).some((t) => /Welcome back/.test(t)));
});

test("combo badges use the best combo", () => {
  const state = freshState(at("2026-10-05"));
  const cheers = answer(state, at("2026-10-05"), { goal: 99, combo: 10 }).cheers;
  assert.ok(badgeIds(cheers).some((t) => /Hot streak/.test(t)));
  assert.ok(!badgeIds(cheers).some((t) => /Unstoppable/.test(t)));
});

test("overachiever needs double the daily goal in one day", () => {
  const state = freshState(at("2026-10-05"));
  assert.ok(!badgeIds(answer(state, at("2026-10-05"), { goal: 2 }).cheers).some((t) => /Overachiever/.test(t)));
  answer(state, at("2026-10-05"), { goal: 2 });
  assert.ok(!state.progress.badges.overachiever); // 2 of 4
  answer(state, at("2026-10-05"), { goal: 2 });
  answer(state, at("2026-10-05"), { goal: 2 });
  assert.ok(state.progress.badges.overachiever);
});

test("a freeze that saves the streak unlocks its badge, and a perfect week needs all seven days", () => {
  const state = freshState(at("2026-10-05"));
  answer(state, at("2026-10-05")); // Mon
  answer(state, at("2026-10-07")); // Wed: Tuesday covered by the weekly freeze
  assert.ok(state.progress.badges.frozen);

  const week = freshState(at("2026-10-05"));
  for (const day of ["05", "06", "07", "08", "09", "10", "11"]) answer(week, at(`2026-10-${day}`));
  assert.ok(week.progress.badges["perfect-week"]);
  assert.ok(week.progress.badges.weekend);
  assert.ok(week.progress.badges.week);
});

test("the companion evolves with the best streak and announces it once", () => {
  assert.deepEqual([0, 6, 7, 29, 30, 90, 180, 364, 365, 1000].map((n) => stageFor(n).index), [0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
  assert.equal(stageFor(0).nextAt, 7);
  assert.equal(stageFor(400).nextAt, null);

  const state = freshState(at("2026-10-05"));
  const evolutions = [];
  for (let i = 0; i < 8; i++) {
    const day = `2026-10-${String(5 + i).padStart(2, "0")}`;
    evolutions.push(...answer(state, at(day)).cheers.filter((c) => c.kind === "evolve"));
  }
  assert.equal(evolutions.length, 1);
  assert.match(evolutions[0].text, /Imp/);
  assert.equal(snapshot(state, { goal: 1, now: at("2026-10-12") }).companion.name, "Imp");
});

test("a broken streak does not undo the evolution", () => {
  const state = freshState(at("2026-10-05"));
  for (let i = 0; i < 7; i++) answer(state, at(`2026-10-${String(5 + i).padStart(2, "0")}`));
  const later = snapshot(state, { goal: 1, now: at("2026-12-01") });
  assert.equal(later.streak.days, 0);
  assert.equal(later.companion.name, "Imp");
});

test("calendarMonth lays out Monday-first weeks with per-day counts", () => {
  const state = freshState(at("2026-10-09"));
  answer(state, at("2026-10-06"), { goal: 2 });
  answer(state, at("2026-10-06"), { goal: 2 }); // goal met on Oct 6
  answer(state, at("2026-10-09"), { goal: 2 });
  const month = calendarMonth(state, { now: at("2026-10-09") });
  assert.equal(month.label, "October 2026");
  assert.ok(month.weeks.every((w) => w.length === 7));
  assert.equal(month.weeks[0].filter(Boolean)[0].day, 1);
  assert.equal(month.weeks[0][3].day, 1); // 1 Oct 2026 is a Thursday
  const tuesday = month.weeks[1][1];
  assert.deepEqual([tuesday.day, tuesday.correct, tuesday.goalMet], [6, 2, true]);
  const friday = month.weeks[1][4];
  assert.deepEqual([friday.day, friday.correct, friday.today, friday.future], [9, 1, true, false]);
  assert.equal(month.weeks[1][5].future, true);
  assert.equal(month.goalDays, 1);
  assert.equal(month.daysSoFar, 9);
  assert.equal(month.correct, 3);
});

test("calendarMonth can look at earlier months", () => {
  const state = freshState(at("2026-10-09"));
  const september = calendarMonth(state, { offset: -1, now: at("2026-10-09") });
  assert.equal(september.label, "September 2026");
  assert.equal(september.daysSoFar, 30);
  assert.equal(calendarMonth(state, { offset: -10, now: at("2026-10-09") }).label, "December 2025");
});

test("missed words are logged per day, grouped per card, and can be undone", () => {
  const state = freshState(at("2026-10-09"));
  const miss = (key, t) => ({ key, label: "EN → PL", prompt: "cat", expected: ["kot"], answer: "pies", at: t });
  const t1 = at("2026-10-09", 10);
  const t2 = at("2026-10-09", 11);
  recordMiss(state, miss("1:en-pl", t1), t1);
  recordMiss(state, miss("1:en-pl", t2), t2);
  recordMiss(state, miss("2:en-pl", t2), t2);

  const today = missedOn(state, { now: at("2026-10-09", 12) });
  assert.equal(today.items.length, 2);
  assert.equal(today.items.find((i) => i.key === "1:en-pl").times, 2);
  assert.ok(today.items.every((i) => !i.recovered));

  // answered correctly afterwards → recovered
  state.items["1:en-pl"] = { streak: 1, last: at("2026-10-09", 11) + 5000 };
  assert.equal(missedOn(state, { now: at("2026-10-09", 12) }).items.find((i) => i.key === "1:en-pl").recovered, true);

  undoMiss(state, "2:en-pl", t2);
  assert.equal(missedOn(state, { now: at("2026-10-09", 12) }).items.length, 1);

  assert.equal(missedOn(state, { offset: -1, now: at("2026-10-09", 12) }).items.length, 0);
  assert.equal(missedOn(state, { offset: -1, now: at("2026-10-09", 12) }).date, "2026-10-08");
});

test("old misses are pruned", () => {
  const state = freshState(at("2026-10-01"));
  recordMiss(state, { key: "1:en-pl", label: "x", prompt: "x", expected: ["y"], answer: "z", at: at("2026-10-01") }, at("2026-10-01"));
  recordMiss(state, { key: "2:en-pl", label: "x", prompt: "x", expected: ["y"], answer: "z", at: at("2026-10-30") }, at("2026-10-30"));
  assert.equal(state.progress.days["2026-10-01"].missed, undefined);
  assert.equal(state.progress.days["2026-10-30"].missed.length, 1);
});

test("the ring unlocks with the last other badge, in the same answer", () => {
  const state = freshState(at("2026-10-05"));
  for (const badge of BADGES) if (badge.id !== "one-ring" && badge.id !== "hello") state.progress.badges[badge.id] = "2026-10-01";
  assert.equal(state.progress.badges["one-ring"], undefined);

  const { cheers } = answer(state, at("2026-10-05")); // the first correct answer unlocks "Hello!"
  assert.ok(state.progress.badges.hello);
  assert.equal(state.progress.badges["one-ring"], "2026-10-05");
  assert.ok(cheers.some((c) => c.text.includes("The One")));
});

test("the ring stays locked while any other badge is missing", () => {
  const state = freshState(at("2026-10-05"));
  for (const badge of BADGES) if (!["one-ring", "dragons-hoard"].includes(badge.id)) state.progress.badges[badge.id] = "2026-10-01";
  answer(state, at("2026-10-05"));
  assert.equal(state.progress.badges["one-ring"], undefined);
});
