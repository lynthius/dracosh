import { addDays, dayKey, daysBetween, weekStart } from "./dates.js";
import { BOX_INTERVALS_DAYS } from "./scheduler.js";

export const MAX_FREEZES = 2;
const MAX_BOX = BOX_INTERVALS_DAYS.length;
const AT_RISK_HOUR = 19;
const COMEBACK_AFTER_DAYS = 7;
const MISSED_KEEP_DAYS = 14;

// The companion evolves permanently with your best streak, so a broken streak never takes a form away.
export const STAGES = [
  { name: "Hatchling", from: 0 },
  { name: "Imp", from: 7 },
  { name: "Whelp", from: 30 },
  { name: "Drake", from: 90 },
  { name: "Dragon", from: 180 },
  { name: "Legend", from: 365 }
];

export function stageFor(bestStreak) {
  let index = 0;
  while (index + 1 < STAGES.length && bestStreak >= STAGES[index + 1].from) index += 1;
  const next = STAGES[index + 1] ?? null;
  return { index, name: STAGES[index].name, nextName: next?.name ?? null, nextAt: next?.from ?? null };
}

export function ensureProgress(state, now = Date.now()) {
  state.progress ??= {
    days: {},
    streak: { count: 0, best: 0, lastGoalDay: null, freezes: 1, freezeWeek: weekStart(dayKey(now)), freezesUsed: 0 },
    badges: {},
    bestCombo: 0,
    lastActiveDay: null,
    vacations: []
  };
  state.progress.vacations ??= [];
  // one free freeze per calendar week, never more than MAX_FREEZES in stock
  const week = weekStart(dayKey(now));
  const { streak } = state.progress;
  if (streak.freezeWeek !== week) {
    streak.freezeWeek = week;
    streak.freezes = Math.min(MAX_FREEZES, streak.freezes + 1);
  }
  return state.progress;
}

// ---- rest days: weekends (a setting) and vacations never break a streak ----------------------------------------

const NO_RULES = { skipWeekends: false };

export function isRestDay(progress, key, rules = NO_RULES) {
  if (rules.skipWeekends) {
    const weekday = new Date(`${key}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) return true;
  }
  return (progress.vacations ?? []).some((v) => key >= v.from && key <= v.to);
}

// working days strictly between two days on which you did nothing: these are the ones that cost a freeze
function missedDaysBetween(progress, from, to, rules) {
  let missed = 0;
  for (let day = addDays(from, 1); day < to; day = addDays(day, 1)) if (!isRestDay(progress, day, rules)) missed += 1;
  return missed;
}

// the streak as shown right now: alive while no working day was skipped, or while freezes can cover the gap
export function currentStreak(progress, today, rules = NO_RULES) {
  const { count, lastGoalDay, freezes } = progress.streak;
  if (!lastGoalDay || !count) return 0;
  return missedDaysBetween(progress, lastGoalDay, today, rules) <= freezes ? count : 0;
}

function completeDay(progress, today, rules) {
  const streak = progress.streak;
  if (!streak.lastGoalDay) {
    streak.count = 1;
  } else {
    const missed = missedDaysBetween(progress, streak.lastGoalDay, today, rules);
    if (missed === 0) {
      streak.count += 1;
    } else if (missed <= streak.freezes) {
      streak.freezes -= missed;
      streak.freezesUsed = (streak.freezesUsed ?? 0) + missed;
      streak.count += 1;
    } else {
      streak.count = 1;
    }
  }
  streak.lastGoalDay = today;
  streak.best = Math.max(streak.best, streak.count);
  return streak.count;
}

// ---- vacations ---------------------------------------------------------------------------------------------------

export function addVacation(state, from, to, now = Date.now()) {
  const progress = ensureProgress(state, now);
  const merged = [...progress.vacations, { from, to }].sort((a, b) => (a.from < b.from ? -1 : 1));
  progress.vacations = merged.reduce((out, v) => {
    const last = out[out.length - 1];
    if (last && v.from <= addDays(last.to, 1)) last.to = v.to > last.to ? v.to : last.to; // overlapping or touching: one vacation
    else out.push({ ...v });
    return out;
  }, []);
}

// ends the vacation that is running (as of yesterday) and drops the ones still ahead
export function cancelVacations(state, now = Date.now()) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  progress.vacations = progress.vacations
    .map((v) => (v.to < today ? v : v.from < today ? { from: v.from, to: addDays(today, -1) } : null))
    .filter(Boolean);
}

// the vacation running today (if any) and the ones still ahead
export function vacationInfo(progress, today) {
  const upcoming = (progress.vacations ?? []).filter((v) => v.to >= today);
  const active = upcoming.find((v) => v.from <= today) ?? null;
  return { activeUntil: active?.to ?? null, upcoming };
}

const goalMetOn = (progress, key) => Boolean(progress.days[key]?.goalMet);

function goalDaysInMonth(progress, today) {
  const prefix = today.slice(0, 7);
  return Object.entries(progress.days).filter(([key, day]) => key.startsWith(prefix) && day.goalMet).length;
}

// Every day of the Monday-to-Sunday week containing `today` hit its goal
function perfectWeek(progress, today) {
  const monday = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).every((key) => goalMetOn(progress, key));
}

// `s` = stats from collectStats() plus `event`: what this very answer was (correct, hour, days since last activity)
export const BADGES = [
  { id: "hello", name: "Hello!", desc: "your first correct answer", test: (s) => s.totalCorrect >= 1 },
  { id: "first-steps", name: "First steps", desc: "10 correct answers", test: (s) => s.totalCorrect >= 10 },
  { id: "century", name: "Century", desc: "100 correct answers", test: (s) => s.totalCorrect >= 100 },
  { id: "thousand", name: "Thousand", desc: "1,000 correct answers", test: (s) => s.totalCorrect >= 1000 },
  { id: "five-thousand", name: "Five thousand", desc: "5,000 correct answers", test: (s) => s.totalCorrect >= 5000 },
  { id: "ten-thousand", name: "Ten thousand", desc: "10,000 correct answers", test: (s) => s.totalCorrect >= 10000 },
  { id: "dragons-hoard", name: "Dragon's hoard", desc: "25,000 correct answers", test: (s) => s.totalCorrect >= 25000 },

  { id: "on-a-roll", name: "On a roll", desc: "3-day streak", test: (s) => s.bestStreak >= 3 },
  { id: "week", name: "Full week", desc: "7-day streak", test: (s) => s.bestStreak >= 7 },
  { id: "fortnight", name: "Fortnight", desc: "14-day streak", test: (s) => s.bestStreak >= 14 },
  { id: "month", name: "Iron habit", desc: "30-day streak", test: (s) => s.bestStreak >= 30 },
  { id: "hundred-days", name: "Centurion", desc: "100-day streak", test: (s) => s.bestStreak >= 100 },
  { id: "year-of-the-dragon", name: "Year of the dragon", desc: "365-day streak", test: (s) => s.bestStreak >= 365 },

  { id: "keeper", name: "Word keeper", desc: "10 cards mastered", test: (s) => s.mastered >= 10 },
  { id: "collector", name: "Collector", desc: "50 cards mastered", test: (s) => s.mastered >= 50 },
  { id: "dictionary", name: "Walking dictionary", desc: "100 cards mastered", test: (s) => s.mastered >= 100 },
  { id: "lexicon", name: "Living lexicon", desc: "500 cards mastered", test: (s) => s.mastered >= 500 },
  { id: "explorer", name: "Explorer", desc: "250 cards practiced", test: (s) => s.practiced >= 250 },

  { id: "flawless", name: "Flawless", desc: "10+ answers in a day, no miss", test: (s) => s.today.asked >= 10 && s.today.correct === s.today.asked },
  { id: "overachiever", name: "Overachiever", desc: "double your daily goal in a day", test: (s) => s.today.correct >= s.goal * 2 },
  { id: "marathon", name: "Marathon", desc: "30 correct answers in a day", test: (s) => s.today.correct >= 30 },

  { id: "hot-streak", name: "Hot streak", desc: "10 correct in a row", test: (s) => s.bestCombo >= 10 },
  { id: "unstoppable", name: "Unstoppable", desc: "25 correct in a row", test: (s) => s.bestCombo >= 25 },
  { id: "combo-master", name: "Combo master", desc: "50 correct in a row", test: (s) => s.bestCombo >= 50 },

  { id: "early-bird", name: "Early bird", desc: "a correct answer before 8:00", test: (s) => s.event.correct && s.event.hour < 8 },
  { id: "night-owl", name: "Night owl", desc: "a correct answer after 23:00", test: (s) => s.event.correct && s.event.hour >= 23 },

  { id: "comeback", name: "Welcome back", desc: "back after 7+ days away", test: (s) => s.event.correct && s.event.daysAway >= COMEBACK_AFTER_DAYS },
  { id: "redemption", name: "Redemption", desc: "5 words missed today, got right later the same day", test: (s) => s.recoveredToday >= 5 },
  { id: "frozen", name: "Frozen in time", desc: "a freeze saved your streak", test: (s) => s.freezesUsed >= 1 },
  { id: "weekend", name: "Weekend warrior", desc: "goal on both Saturday and Sunday", test: (s) => s.weekendDone },
  { id: "perfect-week", name: "Perfect week", desc: "goal every day, Monday to Sunday", test: (s) => s.perfectWeek },
  { id: "regular", name: "Regular", desc: "goal on 20 days in one month", test: (s) => s.goalDaysThisMonth >= 20 },
  { id: "machine", name: "The machine", desc: "goal on 25 days in one month", test: (s) => s.goalDaysThisMonth >= 25 },
  { id: "hundred-club", name: "Hundred club", desc: "goal reached on 100 days in total", test: (s) => s.totalGoalDays >= 100 },

  { id: "both-ways", name: "Both ways", desc: "50 correct in each direction", test: (s) => s.correctByDirection["en-pl"] >= 50 && s.correctByDirection["pl-en"] >= 50 },

  // keep this one last: it checks the others, including any unlocked earlier in the same answer
  { id: "one-ring", name: "The One", desc: "every other badge", test: (s) => BADGES.every((b) => b.id === "one-ring" || s.badges[b.id]) }
];

function collectStats(state, now, goal) {
  const progress = state.progress;
  const todayKey = dayKey(now);
  const today = progress.days[todayKey] ?? { asked: 0, correct: 0 };
  const items = Object.entries(state.items);
  const correctByDirection = { "en-pl": 0, "pl-en": 0 };
  for (const [key, entry] of items) correctByDirection[key.split(":")[1]] += entry.correct;

  // words missed today that were answered correctly again later the same day (one per card)
  const lastMissByKey = new Map();
  for (const miss of progress.days[todayKey]?.missed ?? []) lastMissByKey.set(miss.key, miss);
  let recoveredToday = 0;
  for (const [key, miss] of lastMissByKey) {
    const entry = state.items[key];
    if (entry && entry.streak > 0 && entry.last > miss.at) recoveredToday += 1;
  }

  const isSunday = new Date(`${todayKey}T12:00:00`).getDay() === 0;
  return {
    goal,
    badges: progress.badges, // live: badges unlocked earlier in the same award pass count too
    totalCorrect: Object.values(progress.days).reduce((sum, d) => sum + d.correct, 0),
    bestStreak: progress.streak.best,
    bestCombo: progress.bestCombo ?? 0,
    freezesUsed: progress.streak.freezesUsed ?? 0,
    mastered: items.filter(([, e]) => e.box === MAX_BOX).length,
    practiced: items.length,
    correctByDirection,
    goalDaysThisMonth: goalDaysInMonth(progress, todayKey),
    totalGoalDays: Object.values(progress.days).filter((d) => d.goalMet).length,
    recoveredToday,
    weekendDone: isSunday && goalMetOn(progress, todayKey) && goalMetOn(progress, addDays(todayKey, -1)),
    perfectWeek: goalMetOn(progress, todayKey) && perfectWeek(progress, todayKey),
    today
  };
}

// Goal check, evolution and badges after something was credited today → cheers
function award(state, progress, day, today, { correct, goal, rules, now, daysAway = 0 }) {
  const cheers = [];
  if (correct && !day.goalMet && day.correct >= goal) {
    day.goalMet = true;
    const stageBefore = stageFor(progress.streak.best);
    const streak = completeDay(progress, today, rules);
    cheers.push({ kind: "goal", text: `Daily goal reached · ${streak}-day streak` });
    const stageAfter = stageFor(progress.streak.best);
    if (stageAfter.index > stageBefore.index)
      cheers.push({ kind: "evolve", text: `Your companion evolved into a${/^[aeiou]/i.test(stageAfter.name) ? "n" : ""} ${stageAfter.name}!` });
  }

  const stats = { ...collectStats(state, now, goal), event: { correct, hour: new Date(now).getHours(), daysAway } };
  for (const badge of BADGES) {
    if (!progress.badges[badge.id] && badge.test(stats)) {
      progress.badges[badge.id] = today;
      cheers.push({ kind: "badge", text: `Badge unlocked: ${badge.name} · ${badge.desc}` });
    }
  }
  return cheers;
}

const dayOf = (progress, today) => (progress.days[today] ??= { asked: 0, correct: 0 });

// Records one answer in the progress log → { cheers[] }. `state.items` must already include this answer.
export function applyAnswer(state, { result, goal, rules = NO_RULES, combo = 0, now = Date.now() }) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const day = dayOf(progress, today);
  const correct = result !== "wrong";
  const daysAway = progress.lastActiveDay ? daysBetween(progress.lastActiveDay, today) : 0;

  day.asked += 1;
  day.correct += correct ? 1 : 0;
  progress.bestCombo = Math.max(progress.bestCombo ?? 0, combo);
  progress.lastActiveDay = today;
  return { cheers: award(state, progress, day, today, { correct, goal, rules, now, daysAway }) };
}

// A wrong answer the user then declared right: it was already counted as asked, so only credit the correct one
export function applyOverrule(state, { goal, rules = NO_RULES, combo = 0, now = Date.now() }) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const day = dayOf(progress, today);

  day.correct += 1;
  progress.bestCombo = Math.max(progress.bestCombo ?? 0, combo);
  return { cheers: award(state, progress, day, today, { correct: true, goal, rules, now }) };
}

// everything the screens display, derived from state
export function snapshot(state, { goal, rules = NO_RULES, now = Date.now() }) {
  const progress = ensureProgress(state, now);
  const stats = collectStats(state, now, goal);
  const today = dayKey(now);
  const days = currentStreak(progress, today, rules);
  const restToday = isRestDay(progress, today, rules);
  const goalMet = Boolean(stats.today.goalMet) || stats.today.correct >= goal;
  return {
    today: { ...stats.today, goalMet },
    goal,
    streak: {
      days,
      best: progress.streak.best,
      freezes: progress.streak.freezes,
      atRisk: days > 0 && !goalMet && !restToday && new Date(now).getHours() >= AT_RISK_HOUR
    },
    restToday,
    skipWeekends: rules.skipWeekends,
    vacation: vacationInfo(progress, today),
    companion: stageFor(progress.streak.best),
    totalCorrect: stats.totalCorrect,
    mastered: stats.mastered,
    practiced: stats.practiced,
    badges: BADGES.map((b) => ({ id: b.id, name: b.name, desc: b.desc, unlockedOn: progress.badges[b.id] ?? null }))
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// One calendar month, weeks Monday..Sunday: each day has the number of correct answers and whether the goal was met.
// `offset` moves back (negative) or forward from the current month.
export function calendarMonth(state, { offset = 0, rules = NO_RULES, now = Date.now() } = {}) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const [year, month] = today.split("-").map(Number);
  const first = new Date(year, month - 1 + offset, 1, 12);
  const firstKey = dayKey(first);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

  const cells = Array.from({ length: daysInMonth }, (_, i) => {
    const key = addDays(firstKey, i);
    const day = progress.days[key];
    return { key, day: i + 1, correct: day?.correct ?? 0, goalMet: Boolean(day?.goalMet), rest: isRestDay(progress, key, rules), future: daysBetween(today, key) > 0, today: key === today };
  });

  const lead = (first.getDay() + 6) % 7; // blank cells before the 1st so columns line up Mon..Sun
  const padded = [...Array(lead).fill(null), ...cells];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push([...padded.slice(i, i + 7), ...Array(Math.max(0, i + 7 - padded.length)).fill(null)]);

  return {
    label: `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`,
    weeks,
    goalDays: cells.filter((c) => c.goalMet).length,
    correct: cells.reduce((sum, c) => sum + c.correct, 0),
    daysSoFar: cells.filter((c) => !c.future).length
  };
}

// ---- words you got wrong (for /missed) -------------------------------------------------------------------------

// miss = { key, label, prompt, expected[], answer, at }; kept per day, and only for the last MISSED_KEEP_DAYS days
export function recordMiss(state, miss, now = Date.now()) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  (dayOf(progress, today).missed ??= []).push(miss);
  for (const [key, day] of Object.entries(progress.days)) {
    if (day.missed && daysBetween(key, today) > MISSED_KEEP_DAYS) delete day.missed;
  }
}

// the miss no longer counts (the user declared that answer right)
export function undoMiss(state, key, at) {
  const day = state.progress?.days[dayKey(at)];
  if (!day?.missed) return;
  const index = day.missed.findLastIndex((m) => m.key === key && m.at === at);
  if (index >= 0) day.missed.splice(index, 1);
}

// Misses of one day (offset 0 = today, -1 = yesterday...), one row per card with how often it was missed.
// `recovered` = answered correctly since.
export function missedOn(state, { offset = 0, now = Date.now() } = {}) {
  const progress = ensureProgress(state, now);
  const date = addDays(dayKey(now), offset);
  const rows = new Map();
  for (const miss of progress.days[date]?.missed ?? []) {
    const row = rows.get(miss.key);
    rows.set(miss.key, { ...miss, times: (row?.times ?? 0) + 1 });
  }
  const items = [...rows.values()]
    .map((row) => {
      const entry = state.items[row.key];
      return { ...row, recovered: Boolean(entry && entry.streak > 0 && entry.last > row.at) };
    })
    .sort((a, b) => b.at - a.at);
  return { date, items };
}
