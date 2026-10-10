import { addDays, dayKey, daysBetween, weekStart } from "./dates.js";
import { BOX_INTERVALS_DAYS } from "./scheduler.js";

export const MAX_FREEZES = 2;
const MAX_BOX = BOX_INTERVALS_DAYS.length;
const AT_RISK_HOUR = 19;
const COMEBACK_AFTER_DAYS = 5;
const MISSED_KEEP_DAYS = 14;
const FALL_MIN = 30; // a lost streak this long counts as a fall for "Dragon's die"

// The die's faces: winning "Dragon's die" rolls one, and the dragon keeps that element for good.
export const ELEMENTS = ["earth", "wind", "water", "ice", "fire", "cosmos"];
export const rollElement = (random = Math.random) => ELEMENTS[Math.floor(random() * ELEMENTS.length)];
export const ELEMENT_ADJECTIVE = { earth: "Earth", wind: "Wind", water: "Water", ice: "Ice", fire: "Fire", cosmos: "Cosmic" };

// what the dragon is called: its form, with its element in front once it has one ("Ice Drake")
export const dragonName = (stage, element = null) => (element ? `${ELEMENT_ADJECTIVE[element]} ${STAGES[stage].name}` : STAGES[stage].name);

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
    streak: { count: 0, best: 0, lastGoalDay: null, freezes: MAX_FREEZES, freezeWeek: weekStart(dayKey(now)), freezesUsed: 0 },
    badges: {},
    bestCombo: 0,
    lastActiveDay: null,
    vacations: []
  };
  state.progress.vacations ??= [];
  // badges already shown in /badges; ones unlocked before this was tracked count as seen, so they don't all flash at once
  state.progress.seenBadges ??= Object.keys(state.progress.badges);
  return state.progress;
}

// ---- rest days: weekends (a setting) and vacations never break a streak ----------------------------------------

const NO_RULES = { skipWeekends: false };

export function isRestDay(progress, key, rules = NO_RULES) {
  if (progress.days?.[key]?.nothingDue) return true; // opened, but no card anywhere was waiting
  if (rules.skipWeekends) {
    const weekday = new Date(`${key}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) return true;
  }
  return (progress.vacations ?? []).some((v) => key >= v.from && key <= v.to);
}

// Freezes as they stand today, walking day by day from the last goal day: every new week gives one
// back (never more than MAX_FREEZES in stock), every missed working day takes one. A gap with more
// missed days than freezes breaks the streak and takes none. The stored streak.freezes / freezeWeek
// are as of the last time this was settled (a goal day); nothing is spent until then, but the
// screens show this walk, so they never promise freezes that are already used.
function walkFreezes(progress, today, rules) {
  const { lastGoalDay, freezes: stored, freezeWeek } = progress.streak;
  const walk = (spend) => {
    let freezes = stored;
    let week = freezeWeek ?? weekStart(today);
    let used = 0;
    for (let day = lastGoalDay ? addDays(lastGoalDay, 1) : today; day <= today; day = addDays(day, 1)) {
      const dayWeek = weekStart(day);
      if (dayWeek > week) {
        freezes = Math.min(MAX_FREEZES, freezes + Math.round(daysBetween(week, dayWeek) / 7));
        week = dayWeek;
      }
      if (!spend || day === today || isRestDay(progress, day, rules)) continue;
      if (freezes === 0) return null; // the streak breaks here
      freezes -= 1;
      used += 1;
    }
    return { freezes, week, used };
  };
  const spent = lastGoalDay ? walk(true) : null;
  return spent ? { ...spent, broken: false } : { ...walk(false), used: 0, broken: Boolean(lastGoalDay) };
}

// the streak as shown right now: alive while no working day was skipped, or while freezes can cover the gap
export function currentStreak(progress, today, rules = NO_RULES) {
  const { count, lastGoalDay } = progress.streak;
  if (!lastGoalDay || !count) return 0;
  return walkFreezes(progress, today, rules).broken ? 0 : count;
}

export const freezesNow = (progress, today, rules = NO_RULES) => walkFreezes(progress, today, rules).freezes;

function completeDay(progress, today, rules) {
  const streak = progress.streak;
  const { freezes, week, used, broken } = walkFreezes(progress, today, rules);
  if (!streak.lastGoalDay) {
    streak.count = 1;
  } else if (broken) {
    if (streak.count >= FALL_MIN) streak.fallen = streak.count; // the most recent long streak that was lost
    streak.count = 1;
  } else {
    streak.count += 1;
    streak.freezesUsed = (streak.freezesUsed ?? 0) + used;
  }
  Object.assign(streak, { freezes, freezeWeek: week, lastGoalDay: today });
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
  { id: "dragons-hoard", name: "Dragon's hoard", desc: "20,000 correct answers", test: (s) => s.totalCorrect >= 20000 },

  { id: "on-a-roll", name: "On a roll", desc: "3-day streak", test: (s) => s.bestStreak >= 3 },
  { id: "week", name: "Full week", desc: "7-day streak", test: (s) => s.bestStreak >= 7 },
  { id: "fortnight", name: "Fortnight", desc: "14-day streak", test: (s) => s.bestStreak >= 14 },
  { id: "month", name: "Iron habit", desc: "30-day streak", test: (s) => s.bestStreak >= 30 },
  { id: "hundred-days", name: "Centurion", desc: "100-day streak", test: (s) => s.bestStreak >= 100 },
  { id: "dragonheart", name: "Dragonheart", desc: "180-day streak", test: (s) => s.bestStreak >= 180 },

  { id: "keeper", name: "Word keeper", desc: "10 cards mastered", test: (s) => s.mastered >= 10 },
  { id: "collector", name: "Collector", desc: "25 cards mastered", test: (s) => s.mastered >= 25 },
  { id: "dictionary", name: "Walking dictionary", desc: "50 cards mastered", test: (s) => s.mastered >= 50 },
  { id: "lexicon", name: "Living lexicon", desc: "150 cards mastered", test: (s) => s.mastered >= 150 },
  { id: "explorer", name: "Explorer", desc: "250 cards practised", test: (s) => s.practiced >= 250 },

  { id: "flawless", name: "Flawless", desc: "10+ answers in a day, no miss", test: (s) => s.today.asked >= 10 && s.today.correct === s.today.asked },
  { id: "overachiever", name: "Overachiever", desc: "double your daily goal in a day", test: (s) => s.today.correct >= s.goal * 2 },
  { id: "marathon", name: "Marathon", desc: "30 correct answers in a day", test: (s) => s.today.correct >= 30 },

  { id: "hot-streak", name: "Hot streak", desc: "10 correct in a row", test: (s) => s.bestCombo >= 10 },
  { id: "unstoppable", name: "Unstoppable", desc: "25 correct in a row", test: (s) => s.bestCombo >= 25 },
  { id: "combo-master", name: "Combo master", desc: "50 correct in a row", test: (s) => s.bestCombo >= 50 },

  { id: "early-bird", name: "Early bird", desc: "a correct answer before 8:00", test: (s) => s.event.correct && s.event.hour < 8 },
  { id: "night-owl", name: "Night owl", desc: "a correct answer after 23:00", test: (s) => s.event.correct && s.event.hour >= 23 },

  { id: "comeback", name: "Welcome back", desc: "back after 5+ days away", test: (s) => s.event.correct && s.event.daysAway >= COMEBACK_AFTER_DAYS },
  { id: "redemption", name: "Redemption", desc: "5 words missed today, got right later the same day", test: (s) => s.recoveredToday >= 5 },
  { id: "frozen", name: "Frozen in time", desc: "a freeze saved your streak", test: (s) => s.freezesUsed >= 1 },
  { id: "weekend", name: "Weekend warrior", desc: "goal on both Saturday and Sunday", test: (s) => s.weekendDone },
  { id: "perfect-week", name: "Perfect week", desc: "goal every day, Monday to Sunday", test: (s) => s.perfectWeek },
  { id: "regular", name: "Regular", desc: "goal on 20 days in one month", test: (s) => s.goalDaysThisMonth >= 20 },
  { id: "machine", name: "The machine", desc: "goal on 25 days in one month", test: (s) => s.goalDaysThisMonth >= 25 },
  { id: "hundred-club", name: "Hundred club", desc: "goal reached on 100 days in total", test: (s) => s.totalGoalDays >= 100 },


  // keep this one last: it checks the others, including any unlocked earlier in the same answer
  { id: "one-ring", name: "The One...", desc: "every other badge", test: (s) => BADGES.every((b) => b.id === "one-ring" || b.hidden || s.badges[b.id]) },

  // hidden: shown as "???" until won, and not needed for The One
  {
    id: "dragons-die",
    name: "Dragon's die",
    desc: "lost a 30+ day streak, then built a longer one",
    hidden: true,
    test: (s) => s.fallenStreak >= FALL_MIN && s.streakCount > s.fallenStreak
  }
];

// progress is kept per card and direction ("id:en-pl"); badges count cards
const cardOf = (key) => key.slice(0, key.lastIndexOf(":"));

// a card is mastered once every direction it's been asked in has reached the last box
function masteredCards(items) {
  const byCard = new Map();
  for (const [key, entry] of items) byCard.set(cardOf(key), (byCard.get(cardOf(key)) ?? true) && entry.box === MAX_BOX);
  return [...byCard.values()].filter(Boolean).length;
}

function collectStats(state, now, goal) {
  const progress = state.progress;
  const todayKey = dayKey(now);
  const today = progress.days[todayKey] ?? { asked: 0, correct: 0 };
  const items = Object.entries(state.items);

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
    fallenStreak: progress.streak.fallen ?? 0,
    streakCount: progress.streak.count,
    totalCorrect: Object.values(progress.days).reduce((sum, d) => sum + d.correct, 0),
    bestStreak: progress.streak.best,
    bestCombo: progress.bestCombo ?? 0,
    freezesUsed: progress.streak.freezesUsed ?? 0,
    mastered: masteredCards(items),
    practiced: new Set(items.map(([key]) => cardOf(key))).size,
    goalDaysThisMonth: goalDaysInMonth(progress, todayKey),
    totalGoalDays: Object.values(progress.days).filter((d) => d.goalMet).length,
    recoveredToday,
    weekendDone: isSunday && goalMetOn(progress, todayKey) && goalMetOn(progress, addDays(todayKey, -1)),
    perfectWeek: goalMetOn(progress, todayKey) && perfectWeek(progress, todayKey),
    today
  };
}

// Goal check, evolution and badges after something was credited today → cheers
// `caughtUp`: nothing is left to practise today, which counts as reaching the goal (a small deck can't
// give 20 answers a day, and doing everything there is to do shouldn't cost a streak).
function award(state, progress, day, today, { correct, goal, rules, now, daysAway = 0, caughtUp = false, random = Math.random }) {
  const cheers = [];
  if (((correct && day.correct >= goal) || caughtUp) && !day.goalMet) {
    day.goalMet = true;
    if (caughtUp) day.caughtUp = true;
    const stageBefore = stageFor(progress.streak.best);
    const streak = completeDay(progress, today, rules);
    cheers.push({ kind: "goal", text: `${caughtUp ? "All done for today" : "Daily goal reached"} · ${streak}-day streak` });
    const stageAfter = stageFor(progress.streak.best);
    if (stageAfter.index > stageBefore.index)
      cheers.push({ kind: "evolve", text: `Your companion evolved into a${/^[aeiou]/i.test(stageAfter.name) ? "n" : ""} ${stageAfter.name}!` });
  }

  const stats = { ...collectStats(state, now, goal), event: { correct, hour: new Date(now).getHours(), daysAway } };
  for (const badge of BADGES) {
    if (!progress.badges[badge.id] && badge.test(stats)) {
      progress.badges[badge.id] = today;
      cheers.push({ kind: "badge", id: badge.id, name: badge.name, desc: badge.desc, text: `Badge unlocked: ${badge.name} · ${badge.desc}` });
      // rolled and saved right away, before any animation, so quitting mid-roll can't reroll it
      if (badge.id === "dragons-die" && !progress.element && !progress.elementDropped) {
        progress.element = rollElement(random);
        progress.elementRoll = { face: ELEMENTS.indexOf(progress.element) + 1, on: today };
      }
    }
  }
  return cheers;
}

const dayOf = (progress, today) => (progress.days[today] ??= { asked: 0, correct: 0 });

// Records one answer in the progress log → { cheers[] }. `state.items` must already include this answer.
export function applyAnswer(state, { result, goal, rules = NO_RULES, combo = 0, now = Date.now(), random = Math.random }) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const day = dayOf(progress, today);
  const correct = result !== "wrong";
  // full days away since the last correct answer (a wrong first answer back doesn't end the absence)
  const daysAway = progress.lastActiveDay ? daysBetween(progress.lastActiveDay, today) - 1 : 0;

  day.asked += 1;
  day.correct += correct ? 1 : 0;
  progress.bestCombo = Math.max(progress.bestCombo ?? 0, combo);
  if (correct) progress.lastActiveDay = today;
  return { cheers: award(state, progress, day, today, { correct, goal, rules, now, daysAway, random }) };
}

// A wrong answer the user then declared right: it was already counted as asked, so only credit the correct one
export function applyOverrule(state, { goal, rules = NO_RULES, combo = 0, now = Date.now(), random = Math.random }) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const day = dayOf(progress, today);

  const daysAway = progress.lastActiveDay ? daysBetween(progress.lastActiveDay, today) - 1 : 0;
  day.correct += 1;
  progress.bestCombo = Math.max(progress.bestCombo ?? 0, combo);
  progress.lastActiveDay = today;
  return { cheers: award(state, progress, day, today, { correct: true, goal, rules, now, daysAway, random }) };
}

// Nothing left to practise today in the whole library → cheers. After at least one right answer today
// that counts as the goal (see award); with nothing answered at all the day only becomes a rest day, so just
// opening Dracosh never builds a streak. Nothing happens once the goal is met.
export function applyCaughtUp(state, { goal, rules = NO_RULES, now = Date.now(), random = Math.random }) {
  const progress = ensureProgress(state, now);
  const today = dayKey(now);
  const day = dayOf(progress, today);
  if (day.goalMet) return { cheers: [] };
  if (!day.asked) {
    day.nothingDue = true;
    return { cheers: [] };
  }
  if (!day.correct) return { cheers: [] }; // a day of misses only isn't a day done

  return { cheers: award(state, progress, day, today, { correct: false, goal, rules, now, caughtUp: true, random }) };
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
      freezes: freezesNow(progress, today, rules),
      atRisk: days > 0 && !goalMet && !restToday && new Date(now).getHours() >= AT_RISK_HOUR
    },
    restToday,
    skipWeekends: rules.skipWeekends,
    vacation: vacationInfo(progress, today),
    companion: { ...stageFor(progress.streak.best), element: progress.element ?? null, roll: progress.elementRoll ?? null },
    totalCorrect: stats.totalCorrect,
    mastered: stats.mastered,
    practiced: stats.practiced,
    badges: BADGES.map((b) => ({ id: b.id, name: b.name, desc: b.desc, hidden: Boolean(b.hidden), unlockedOn: progress.badges[b.id] ?? null }))
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

// ---- badges you haven't looked at yet (they light up when /badges opens) ----------------------------------

// → ids of badges unlocked but not yet seen in /badges, in the order they were won
export function unseenBadges(state, now = Date.now()) {
  const progress = ensureProgress(state, now);
  return BADGES.map((badge, index) => ({ id: badge.id, index, on: progress.badges[badge.id] }))
    .filter((b) => b.on && !progress.seenBadges.includes(b.id))
    .sort((a, b) => (a.on === b.on ? a.index - b.index : a.on < b.on ? -1 : 1))
    .map((b) => b.id);
}

export function markBadgesSeen(state, now = Date.now()) {
  const progress = ensureProgress(state, now);
  progress.seenBadges = Object.keys(progress.badges);
}
