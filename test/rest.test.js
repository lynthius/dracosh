import assert from "node:assert/strict";
import { test } from "node:test";
import { addVacation, applyAnswer, calendarMonth, cancelVacations, currentStreak, ensureProgress, snapshot } from "../src/progress.js";
import { parseVacation } from "../src/vacation.js";

const at = (day, hour = 10) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).getTime();
const weekdays = { skipWeekends: true };
const fresh = (now) => {
  const state = { items: {}, newToday: { date: "", count: 0 } };
  ensureProgress(state, now);
  return state;
};
const done = (state, day, rules) => applyAnswer(state, { result: "exact", goal: 1, rules, now: at(day) });

// 2026-10-09 is a Friday: 10 and 11 are the weekend, 12 is Monday
test("weekends don't break a streak when they are rest days", () => {
  const state = fresh(at("2026-10-08"));
  done(state, "2026-10-08", weekdays); // Thu
  done(state, "2026-10-09", weekdays); // Fri
  assert.equal(currentStreak(state.progress, "2026-10-12", weekdays), 2); // Monday, nothing skipped yet
  done(state, "2026-10-12", weekdays);
  assert.equal(state.progress.streak.count, 3);
  assert.equal(state.progress.streak.freezesUsed ?? 0, 0); // no freeze was spent
});

test("without the setting, a weekend costs freezes like any other day", () => {
  const state = fresh(at("2026-10-08"));
  done(state, "2026-10-08");
  done(state, "2026-10-09");
  // Sat + Sun skipped = 2 missed days; make the stock empty and skip Monday's weekly freeze
  state.progress.streak.freezes = 0;
  state.progress.streak.freezeWeek = "2026-10-12";
  assert.equal(currentStreak(state.progress, "2026-10-12"), 0);
  done(state, "2026-10-12");
  assert.equal(state.progress.streak.count, 1);
});

test("doing the goal on a weekend still counts", () => {
  const state = fresh(at("2026-10-09"));
  done(state, "2026-10-09", weekdays); // Fri
  done(state, "2026-10-10", weekdays); // Sat
  done(state, "2026-10-12", weekdays); // Mon
  assert.equal(state.progress.streak.count, 3);
});

test("a skipped working day still breaks it (a freeze covers one)", () => {
  const state = fresh(at("2026-10-05"));
  done(state, "2026-10-05", weekdays); // Mon
  // Tue, Wed and Thu skipped, back on Fri: 3 missed working days, 2 freezes
  assert.equal(currentStreak(state.progress, "2026-10-09", weekdays), 0);
  // Tue and Wed skipped, back on Thu: covered by the two freezes
  assert.equal(currentStreak(state.progress, "2026-10-08", weekdays), 1);
});

test("a vacation covers every day in it, however long", () => {
  const state = fresh(at("2026-12-18"));
  done(state, "2026-12-18", weekdays); // Fri
  addVacation(state, "2026-12-21", "2027-01-06");
  assert.equal(currentStreak(state.progress, "2027-01-07", weekdays), 1); // still alive on the first day back
  done(state, "2027-01-07", weekdays);
  assert.equal(state.progress.streak.count, 2);
  assert.equal(state.progress.streak.freezesUsed ?? 0, 0); // none spent
});

test("a day after the vacation ends is a working day again", () => {
  const state = fresh(at("2026-10-05"));
  done(state, "2026-10-05", weekdays); // Mon
  addVacation(state, "2026-10-06", "2026-10-06");
  // Tue is vacation, Wed + Thu skipped (2 freezes), back on Fri
  assert.equal(currentStreak(state.progress, "2026-10-09", weekdays), 1);
  // Tue vacation, Wed to Fri skipped (the weekend rests), back on Mon: 3 working days missed
  assert.equal(currentStreak(state.progress, "2026-10-12", weekdays), 0);
});

test("overlapping and touching vacations merge, and cancelling keeps the past", () => {
  const state = fresh(at("2026-10-01"));
  addVacation(state, "2026-10-10", "2026-10-14");
  addVacation(state, "2026-10-13", "2026-10-20");
  addVacation(state, "2026-10-21", "2026-10-22");
  assert.deepEqual(state.progress.vacations, [{ from: "2026-10-10", to: "2026-10-22" }]);

  cancelVacations(state, at("2026-10-15")); // we're in the middle of it
  assert.deepEqual(state.progress.vacations, [{ from: "2026-10-10", to: "2026-10-14" }]);
  cancelVacations(state, at("2026-10-30"));
  assert.deepEqual(state.progress.vacations, [{ from: "2026-10-10", to: "2026-10-14" }]); // already over: kept
});

test("the snapshot knows about rest days, vacation and no streak risk on them", () => {
  const state = fresh(at("2026-10-09"));
  done(state, "2026-10-09", weekdays);
  const saturday = snapshot(state, { goal: 5, rules: weekdays, now: at("2026-10-10", 21) });
  assert.equal(saturday.restToday, true);
  assert.equal(saturday.streak.atRisk, false); // 21:00 on a rest day
  assert.equal(snapshot(state, { goal: 5, rules: weekdays, now: at("2026-10-12", 21) }).streak.atRisk, true);

  addVacation(state, "2026-10-13", "2026-10-16");
  const during = snapshot(state, { goal: 5, rules: weekdays, now: at("2026-10-14", 21) });
  assert.equal(during.vacation.activeUntil, "2026-10-16");
  assert.equal(during.streak.atRisk, false);
});

test("the calendar marks rest days", () => {
  const state = fresh(at("2026-10-09"));
  addVacation(state, "2026-10-20", "2026-10-21");
  const days = calendarMonth(state, { rules: weekdays, now: at("2026-10-09") }).weeks.flat().filter(Boolean);
  const rest = (n) => days.find((d) => d.day === n).rest;
  assert.equal(rest(10), true); // Saturday
  assert.equal(rest(12), false); // Monday
  assert.equal(rest(20), true); // vacation
  assert.equal(rest(22), false);
  assert.equal(calendarMonth(state, { now: at("2026-10-09") }).weeks.flat().filter(Boolean).find((d) => d.day === 10).rest, false); // setting off
});

test("parseVacation understands days, ranges, single dates, off and list", () => {
  const today = "2026-10-09";
  assert.deepEqual(parseVacation("", today), { action: "list" });
  assert.deepEqual(parseVacation("OFF", today), { action: "off" });
  assert.deepEqual(parseVacation("7", today), { action: "add", from: "2026-10-09", to: "2026-10-15" });
  assert.deepEqual(parseVacation("3d", today), { action: "add", from: "2026-10-09", to: "2026-10-11" });
  assert.deepEqual(parseVacation("24.12 2.01", today), { action: "add", from: "2026-12-24", to: "2027-01-02" });
  assert.deepEqual(parseVacation("24.12..02.01", today), { action: "add", from: "2026-12-24", to: "2027-01-02" });
  assert.deepEqual(parseVacation("2026-12-24 to 2026-12-26", today), { action: "add", from: "2026-12-24", to: "2026-12-26" });
  assert.deepEqual(parseVacation("26.12 24.12", today), { action: "add", from: "2026-12-24", to: "2026-12-26" }); // swapped
  assert.deepEqual(parseVacation("24.12", today), { action: "add", from: "2026-12-24", to: "2026-12-24" });
  assert.deepEqual(parseVacation("5.10", today), { action: "add", from: "2027-10-05", to: "2027-10-05" }); // already past this year
  assert.deepEqual(parseVacation("5.10.2026", today), { action: "add", from: "2026-10-05", to: "2026-10-05" }); // explicit year: the past is allowed
  assert.deepEqual(parseVacation("28.12 3.01", "2026-12-30"), { action: "add", from: "2026-12-28", to: "2027-01-03" }); // across New Year
  assert.equal(parseVacation("31.02", today), null);
  assert.equal(parseVacation("0", today), null);
  assert.equal(parseVacation("500", today), null);
  assert.equal(parseVacation("soon", today), null);
  assert.equal(parseVacation("1.01.2026 1.01.2028", today), null); // far too long
});

test("parsePause tells a short break from days off", async () => {
  const { parsePause } = await import("../src/pause.js");
  const today = "2026-10-05";
  assert.deepEqual(parsePause("2h", today), { action: "snooze", ms: 7_200_000 });
  assert.deepEqual(parsePause("90s", today), { action: "snooze", ms: 90_000 });
  assert.deepEqual(parsePause("3d", today), { action: "days", from: "2026-10-05", to: "2026-10-07" });
  assert.deepEqual(parsePause("24.12 2.01", today), { action: "days", from: "2026-12-24", to: "2027-01-02" });
  assert.deepEqual(parsePause("", today), { action: "list" });
  assert.deepEqual(parsePause("OFF", today), { action: "off" });
  assert.equal(parsePause("30", today), null);
  assert.equal(parsePause("soon", today), null);
});
