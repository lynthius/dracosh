import { closestCandidate, judge } from "./judge.js";
import { addVacation, applyAnswer, applyOverrule, calendarMonth, cancelVacations, ensureProgress, markBadgesSeen, missedOn, recordMiss, snapshot, undoMiss, unseenBadges, vacationInfo } from "./progress.js";
import { describeDue, grade, itemKey, pickNext } from "./scheduler.js";
import { recordAnswer, saveState } from "./store.js";
import { createTipDeck } from "./tips.js";
import { dayKey } from "./dates.js";
import { formatRange, parseVacation } from "./vacation.js";

const LABELS = { "en-pl": "EN → PL", "pl-en": "PL → EN" };

// the tag on the card's border: the language pair for a language deck, the deck's name otherwise
function labelOf(deck, direction) {
  if (!deck) return LABELS[direction];
  if (!deck.languages) return deck.name;
  const { front, back } = deck.languages;
  const [from, to] = direction === "en-pl" ? [front, back] : [back, front];
  return `${from.toUpperCase()} → ${to.toUpperCase()}`;
}
const COMBO_CHEER_EVERY = 5;

// Quiz logic without any I/O of its own: words, settings and persistence are injected, the UI only renders what this returns.
export function createSession({ loadWords, state, getSettings, save = saveState, now = Date.now, tipDeck = createTipDeck({ state }) }) {
  const rules = () => ({ skipWeekends: getSettings().skipWeekends });
  const totals = { asked: 0, correct: 0, combo: 0 };
  let lastNoteId = null;
  let inTour = false; // the tour teaches one thing per card; tips on top of that are too much
  let lastWrong = null; // the latest wrong answer, until the next question: /correct can still overrule it

  async function next() {
    const { words, deck } = await loadWords();
    inTour = Boolean(deck?.tour);
    const item = pickNext({ words, state, now: now(), lastNoteId, directions: directionsOf(deck), tour: deck?.tour });
    // nothing to ask is a normal state (a finished tour, a new deck), not an error: the UI shows a way on
    if (!item) throw Object.assign(new Error(deck?.tour ? "You've finished the tour." : `The deck "${deck?.name}" has no cards yet.`), { empty: true, tour: Boolean(deck?.tour) });
    lastNoteId = item.word.noteId;
    lastWrong = null;

    const forward = item.direction === "en-pl";
    return {
      word: item.word,
      direction: item.direction,
      label: labelOf(deck, item.direction),
      prompt: forward ? item.word.word : item.word.translations.join(", "),
      expected: forward ? item.word.translations : [item.word.word],
      wordCount: words.length
    };
  }

  // Each deck decides which way it's asked (set when it's made): both ways, or one way only
  // ("2 + 2" → "4"). The front-to-back direction is keyed "en-pl" internally, whatever the languages.
  function directionsOf(deck) {
    return deck?.directions === "forward" ? ["en-pl"] : ["en-pl", "pl-en"];
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

  // progress of cards that are gone (a removed deck) is dropped with them
  async function forget(cardIds) {
    const ids = new Set(cardIds);
    for (const key of Object.keys(state.items)) if (ids.has(key.slice(0, key.lastIndexOf(":")))) delete state.items[key];
    await save(state);
  }

  // Reset from /settings (the caller makes a backup first). "progress" starts the game over: badges,
  // streak, stats and the dragon's form and element; your cards and their boxes stay. "everything"
  // empties the state as on a fresh install, so the egg hatches again.
  async function reset(scope) {
    if (scope === "everything") {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, { version: 1, items: {}, newToday: { date: "", count: 0 } });
    } else {
      delete state.progress;
      delete state.tips;
    }
    totals.combo = 0;
    lastWrong = null;
    await save(state);
  }

  // the hatching intro plays once ever: on a brand-new state that has never answered anything
  const isFirstRun = () => !state.hatched && Object.keys(state.items).length === 0;

  async function markHatched() {
    state.hatched = true;
    await save(state);
  }

  // /badges: the ones won since it was last opened, which light up one by one; opening it marks them seen
  async function openBadges() {
    const fresh = unseenBadges(state, now());
    if (fresh.length) {
      markBadgesSeen(state, now());
      await save(state);
    }
    return fresh;
  }

  return { totals, next, answer, overrule, canOverrule, stats, month, missed, nextTip, vacation, isFirstRun, markHatched, openBadges, forget, reset, inTour: () => inTour };
}
