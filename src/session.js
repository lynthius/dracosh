import { directionsFor } from "./settings.js";
import { closestCandidate, judge } from "./judge.js";
import { addVacation, applyAnswer, applyOverrule, calendarMonth, cancelVacations, ensureProgress, missedOn, recordMiss, snapshot, undoMiss, vacationInfo } from "./progress.js";
import { describeDue, grade, itemKey, pickNext } from "./scheduler.js";
import { recordAnswer, saveState } from "./store.js";
import { createTipDeck } from "./tips.js";
import { dayKey } from "./dates.js";
import { formatRange, parseVacation } from "./vacation.js";

const LABELS = { "en-pl": "EN → PL", "pl-en": "PL → EN" };
const COMBO_CHEER_EVERY = 5;

// Quiz logic without any I/O of its own: words, settings and persistence are injected, the UI only renders what this returns.
export function createSession({ loadWords, state, getSettings, save = saveState, now = Date.now, tipDeck = createTipDeck({ state }) }) {
  const rules = () => ({ skipWeekends: getSettings().skipWeekends });
  const totals = { asked: 0, correct: 0, combo: 0 };
  let lastNoteId = null;
  let lastWrong = null; // the latest wrong answer, until the next question: /correct can still overrule it

  async function next() {
    const { words, cached } = await loadWords();
    const item = pickNext({ words, state, now: now(), lastNoteId, directions: directionsFor(getSettings().directions) });
    if (!item) throw new Error("No words to ask about.");
    lastNoteId = item.word.noteId;
    lastWrong = null;

    const toPolish = item.direction === "en-pl";
    return {
      word: item.word,
      direction: item.direction,
      label: LABELS[item.direction],
      prompt: toPolish ? item.word.word : item.word.translations.join(", "),
      expected: toPolish ? item.word.translations : [item.word.word],
      wordCount: words.length,
      cached
    };
  }

  async function answer(question, text, { hinted = false } = {}) {
    const key = itemKey(question.word.noteId, question.direction);
    // answers you once declared right (/correct) count for this card from now on
    const result = judge(text, [...question.expected, ...(state.accepted?.[key] ?? [])]);
    const correct = result !== "wrong";
    const t = now();
    const before = state.items[key];
    const comboBefore = totals.combo;
    const entry = grade(before, correct, t, { hinted });
    recordAnswer(state, question.word.noteId, question.direction, entry, t);

    totals.asked += 1;
    totals.correct += correct ? 1 : 0;
    totals.combo = correct ? totals.combo + 1 : 0;
    lastWrong = correct ? null : { question, text, key, before, comboBefore, hinted, at: t };
    if (!correct) recordMiss(state, { key, label: question.label, prompt: question.prompt, expected: question.expected, answer: text, at: t }, t);

    const reward = applyAnswer(state, { result, goal: getSettings().dailyGoal, rules: rules(), combo: totals.combo, now: t });
    const cheers = [...reward.cheers];
    if (correct && totals.combo % COMBO_CHEER_EVERY === 0) cheers.push({ kind: "combo", text: `Combo ×${totals.combo}` });

    await save(state);
    // given/closest feed the per-letter diff the UI shows after a miss or a forgiven typo
    const closest = result === "exact" ? null : closestCandidate(text, [...question.expected, ...(state.accepted?.[key] ?? [])]);
    return { result, hinted: hinted && correct, dueIn: describeDue(entry, t), combo: totals.combo, cheers, given: text, closest };
  }

  // Re-grade the last wrong answer as correct and remember the answer for this card.
  async function overrule() {
    if (!lastWrong) throw new Error("There is no wrong answer to correct.");
    const { text, key, before, comboBefore, hinted, at } = lastWrong;
    lastWrong = null;

    const entry = grade(before, true, at, { hinted });
    state.items[key] = entry;
    undoMiss(state, key, at);
    state.accepted ??= {};
    state.accepted[key] = [...(state.accepted[key] ?? []), text];

    totals.correct += 1;
    totals.combo = comboBefore + 1;
    const { cheers } = applyOverrule(state, { goal: getSettings().dailyGoal, rules: rules(), combo: totals.combo, now: at });

    await save(state);
    return { result: "exact", overruled: true, accepted: text, dueIn: describeDue(entry, now()), combo: totals.combo, cheers };
  }

  const canOverrule = () => lastWrong !== null;

  const stats = () => snapshot(state, { goal: getSettings().dailyGoal, rules: rules(), now: now() });

  const month = (offset) => calendarMonth(state, { offset, rules: rules(), now: now() });
  const missed = (offset) => missedOn(state, { offset, now: now() });

  // /vacation: plan, list or cancel rest days that keep the streak alive → a message for the user
  async function vacation(args) {
    const today = dayKey(now());
    const parsed = parseVacation(args, today);
    if (!parsed) throw new Error("Try /vacation 7, /vacation 24.12 2.01 or /vacation off");

    if (parsed.action === "add") {
      addVacation(state, parsed.from, parsed.to, now());
      await save(state);
      return `Vacation ${formatRange(parsed.from, parsed.to)}: your streak is safe until then`;
    }
    if (parsed.action === "off") {
      cancelVacations(state, now());
      await save(state);
      return "Vacation cancelled";
    }
    const { upcoming } = vacationInfo(ensureProgress(state, now()), today);
    return upcoming.length ? `Vacations: ${upcoming.map((v) => formatRange(v.from, v.to)).join(", ")}` : "No vacation planned. Try /vacation 7 or /vacation 24.12 2.01";
  }

  // a tip for the wait between questions; remembering which ones were shown is best-effort
  function nextTip() {
    const tip = tipDeck.next();
    save(state).catch(() => {});
    return tip;
  }

  // the hatching intro plays once ever: on a brand-new state that has never answered anything
  const isFirstRun = () => !state.hatched && Object.keys(state.items).length === 0;

  async function markHatched() {
    state.hatched = true;
    await save(state);
  }

  return { totals, next, answer, overrule, canOverrule, stats, month, missed, nextTip, vacation, isFirstRun, markHatched };
}
