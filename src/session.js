import { closestCandidate, judge } from "./judge.js";
import { addVacation, applyAnswer, applyCaughtUp, applyOverrule, calendarMonth, cancelVacations, ensureProgress, markBadgesSeen, missedOn, recordMiss, snapshot, undoMiss, unseenBadges, vacationInfo } from "./progress.js";
import { describeDue, grade, itemKey, nextDueAt, pickNext, startOfTomorrow } from "./scheduler.js";
import { recordAnswer, saveState } from "./store.js";
import { createTipDeck } from "./tips.js";
import { dayKey } from "./dates.js";
import { PAUSE_HELP, parsePause } from "./pause.js";
import { formatRange } from "./vacation.js";

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
// `loadAllWords` → [{ words, deck }] for every deck of yours: "all done for today" means the whole library.
export function createSession({ loadWords, loadAllWords, state, getSettings, save = saveState, now = Date.now, tipDeck = createTipDeck({ state }) }) {
  const rules = () => ({ skipWeekends: getSettings().skipWeekends });
  const totals = { asked: 0, correct: 0, combo: 0 };
  let lastNoteId = null;
  let inTour = false; // the tour teaches one thing per card; tips on top of that are too much
  let lastWrong = null; // the latest wrong answer, until the next question: /correct can still overrule it
  let current = { words: [], deck: null }; // the deck the last question came from

  // When nothing is waiting in any of your decks before tomorrow, the day is done → cheers
  async function settleDay() {
    const decks = loadAllWords ? await loadAllWords() : [current].filter((d) => !d.deck?.tour);
    const t = now();
    for (const { words, deck } of decks) {
      const directions = directionsOf(deck);
      if (pickNext({ words, state, now: t, directions })) return [];
      const due = nextDueAt({ words, state, now: t, directions });
      if (due !== null && due < startOfTomorrow(t)) return [];
    }
    const { cheers } = applyCaughtUp(state, { goal: getSettings().dailyGoal, rules: rules(), now: t });
    await save(state);
    return cheers;
  }

  // when the deck's next card is due, if nothing is waiting in it right now (null: something is)
  function upNext() {
    const { words, deck } = current;
    if (deck?.tour || pickNext({ words, state, now: now(), directions: directionsOf(deck) })) return null;
    return nextDueAt({ words, state, now: now(), directions: directionsOf(deck) });
  }

  async function next() {
    const { words, deck } = await loadWords();
    current = { words, deck };
    inTour = Boolean(deck?.tour);
    const item = pickNext({ words, state, now: now(), lastNoteId, directions: directionsOf(deck), tour: deck?.tour });
    // nothing to ask is a normal state, not an error: the UI shows a way on (a finished tour, a new
    // deck) or when the next card is due. Done with everything for today counts as the daily goal.
    if (!item) {
      const empty = { empty: true, tour: Boolean(deck?.tour), count: words.length, nextDue: null, cheers: [] };
      if (!deck?.tour && words.length) {
        empty.nextDue = nextDueAt({ words, state, now: now(), directions: directionsOf(deck) });
        empty.cheers = await settleDay();
      }
      const message = deck?.tour ? "You've finished the tour." : words.length ? "Nothing to practise right now." : `The deck "${deck?.name}" has no cards yet.`;
      throw Object.assign(new Error(message), empty);
    }
    lastNoteId = item.word.noteId;
    lastWrong = null;

    const forward = item.direction === "en-pl";
    return {
      word: item.word,
      direction: item.direction,
      label: labelOf(deck, item.direction),
      prompt: forward ? item.word.word : item.word.translations.join(", "),
      expected: forward ? item.word.translations : [item.word.word],
      wordCount: words.length,
      tour: Boolean(deck?.tour) // the tour marks what to type with `backticks`
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
    recordAnswer(state, question.word.noteId, question.direction, entry, t, { countNew: !question.tour });

    totals.asked += 1;
    totals.correct += correct ? 1 : 0;
    totals.combo = correct ? totals.combo + 1 : 0;
    lastWrong = correct ? null : { question, text, key, before, comboBefore, hinted, at: t };
    // a blank answer on a tour card just shows it: the tour isn't something to have "missed"
    if (!correct && !(question.tour && !text.trim())) recordMiss(state, { key, label: question.label, prompt: question.prompt, expected: question.expected, answer: text, at: t }, t);

    const reward = applyAnswer(state, { result, goal: getSettings().dailyGoal, rules: rules(), combo: totals.combo, now: t });
    const cheers = [...reward.cheers];
    if (correct && totals.combo % COMBO_CHEER_EVERY === 0) cheers.push({ kind: "combo", text: `Combo ×${totals.combo}` });

    await save(state);
    // the last card of the day settles it right away, so quitting now doesn't lose the goal
    if (!question.tour) cheers.push(...(await settleDay()));
    // given/closest feed the per-letter diff the UI shows after a miss or a forgiven typo
    const closest = result === "exact" ? null : closestCandidate(text, [...question.expected, ...(state.accepted?.[key] ?? [])]);
    return { result, hinted: hinted && correct, dueIn: describeDue(entry, t), combo: totals.combo, cheers, given: text, closest, nextDue: upNext() };
  }

  // Re-grade the last wrong answer as correct and remember the answer for this card.
  async function overrule() {
    if (!lastWrong) throw new Error("There is no wrong answer to correct.");
    const { question, text, key, before, comboBefore, hinted, at } = lastWrong;
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
    if (!question.tour) cheers.push(...(await settleDay()));
    return { result: "exact", overruled: true, accepted: text, dueIn: describeDue(entry, now()), combo: totals.combo, cheers, nextDue: upNext() };
  }

  const canOverrule = () => lastWrong !== null && lastWrong.text.trim() !== ""; // nothing typed, nothing to accept

  const stats = () => snapshot(state, { goal: getSettings().dailyGoal, rules: rules(), now: now() });

  const month = (offset) => calendarMonth(state, { offset, rules: rules(), now: now() });
  const missed = (offset) => missedOn(state, { offset, now: now() });

  // /pause: a break today (the UI holds it, this returns its length) or days off that keep the
  // streak (saved here). → { snooze?: ms | "off", list?: true, message? }
  async function pause(args) {
    const today = dayKey(now());
    const parsed = parsePause(args, today);
    if (!parsed) throw new Error(PAUSE_HELP);
    if (parsed.action === "snooze") return { snooze: parsed.ms };
    if (parsed.action === "days") {
      addVacation(state, parsed.from, parsed.to, now());
      await save(state);
      return { message: `Days off ${formatRange(parsed.from, parsed.to)}: your streak is safe until then` };
    }
    if (parsed.action === "off") {
      cancelVacations(state, now());
      await save(state);
      return { snooze: "off", message: "Pause off: questions are back, and no days off are planned" };
    }
    const { upcoming } = vacationInfo(ensureProgress(state, now()), today);
    return { list: true, message: upcoming.length ? `Days off: ${upcoming.map((v) => formatRange(v.from, v.to)).join(", ")}` : `No days off planned. ${PAUSE_HELP}` };
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
    const gone = (key) => ids.has(key.slice(0, key.lastIndexOf(":")));
    for (const key of Object.keys(state.items)) if (gone(key)) delete state.items[key];
    for (const key of Object.keys(state.accepted ?? {})) if (gone(key)) delete state.accepted[key];
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

  return { totals, next, answer, overrule, canOverrule, stats, month, missed, nextTip, pause, isFirstRun, markHatched, openBadges, forget, reset, inTour: () => inTour };
}
