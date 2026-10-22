import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { dayKey } from "./dates.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Each card's next review comes from FSRS (the open-source scheduler Anki offers too): it keeps an estimate of how
// well you know the card (stability, in days, and difficulty, 1 to 10) and asks it again when
// you're about to forget it, at 90% recall. A miss brings the card back in 10 minutes, and a new card
// answered right waits a couple of days.
const scheduler = fsrs({ request_retention: 0.9, learning_steps: ["10m"], relearning_steps: ["10m"], enable_fuzz: true });
export const RELEARN_DELAY = 10 * MINUTE;
export const NEW_PER_DAY = 20;
// a card waiting a month or more between reviews is one you know
export const MASTERED_DAYS = 30;
export { Rating };

export const DIRECTIONS = ["en-pl", "pl-en"];
export const itemKey = (noteId, direction) => `${noteId}:${direction}`;

export function newToday(state, now) {
  return state.newToday?.date === dayKey(now) ? state.newToday.count : 0;
}

// A review is waiting for the whole day it falls due, from midnight: a card answered at 17:00 yesterday
// can be done this morning. But never sooner than half a day after it was answered, so a sitting across
// midnight doesn't ask it again minutes later. A card still being learned (just missed, or new) comes
// back at its minute.
const MIN_GAP = 12 * 60 * MINUTE;
export function readyAt(entry) {
  if (entry.phase !== "review") return entry.due;
  const day = new Date(entry.due);
  day.setHours(0, 0, 0, 0);
  return Math.min(entry.due, Math.max(day.getTime(), (entry.last ?? 0) + MIN_GAP));
}

// the same time of day, `days` calendar days later (a day with a clock change is still one day)
function daysLater(now, days) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

const NEW_RATIO = 0.3; // when both due and unseen items exist, this share of questions introduces a new one
const MAX_OVERDUE_WEIGHT_DAYS = 3;

const pickRandom = (items, random) => items[Math.floor(random() * items.length)];

// Random among due items, but the longer overdue the likelier: weight 1 (just due) up to 4 (3+ days late).
// Sorting by due date instead would replay every review in the order it was first answered.
function pickDue(due, now, random) {
  const weights = due.map((c) => 1 + Math.min(Math.max(now - c.entry.due, 0) / DAY, MAX_OVERDUE_WEIGHT_DAYS));
  let roll = random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < due.length; i++) {
    roll -= weights[i];
    if (roll < 0) return due[i];
  }
  return due[due.length - 1];
}

// What to ask next: a due review or a new card (up to the daily cap), mixed at random; null when there
// is nothing to do right now. Cards are never asked before they're due: answering early would count
// as knowing them without the spacing that makes them stick. Never the same note twice in a row while
// anything else is waiting. A `tour` deck is different: each card is asked once, in deck order, and
// never comes back as a review. A word's own `directions` (a cloze card's gaps) replace the deck's.
export function pickNext({ words, state, now = Date.now(), lastNoteId = null, directions = DIRECTIONS, tour = false, random = Math.random }) {
  const candidates = words.flatMap((word) => (word.directions ?? directions).map((direction) => ({ word, direction, entry: state.items[itemKey(word.noteId, direction)] })));
  if (tour) return candidates.find((c) => !c.entry) ?? null;

  const canIntroduce = newToday(state, now) < NEW_PER_DAY;
  // the other way round of a card already started is no new card: the daily limit counts cards
  const started = new Set(candidates.filter((c) => c.entry).map((c) => c.word.noteId));
  const waiting = candidates.filter((c) => (c.entry ? readyAt(c.entry) <= now : canIntroduce || started.has(c.word.noteId)));
  if (!waiting.length) return null;
  const pool = waiting.some((c) => c.word.noteId !== lastNoteId) ? waiting.filter((c) => c.word.noteId !== lastNoteId) : waiting;

  const due = pool.filter((c) => c.entry);
  const fresh = pool.filter((c) => !c.entry);
  if (due.length && fresh.length && random() < NEW_RATIO) return pickRandom(fresh, random);
  return due.length ? pickDue(due, now, random) : pickRandom(fresh, random);
}

// When something will next be waiting, once pickNext has nothing: the earliest due card, or the
// start of tomorrow when only new cards are left (the daily cap is reached). null = nothing ever.
export function nextDueAt({ words, state, now = Date.now(), directions = DIRECTIONS }) {
  let next = null;
  for (const word of words) {
    for (const direction of word.directions ?? directions) {
      const entry = state.items[itemKey(word.noteId, direction)];
      const at = entry ? readyAt(entry) : startOfTomorrow(now);
      if (next === null || at < next) next = at;
    }
  }
  return next;
}

export function startOfTomorrow(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

// How an answer rates for FSRS: a miss or "didn't know" is Again; right, but with a hint, a typo or
// "almost" (an article, an umlaut), is Hard; right is Good. Easy isn't used: typing it is the test.
export const ratingFor = ({ correct, hinted = false, almost = false }) => (!correct ? Rating.Again : hinted || almost ? Rating.Hard : Rating.Good);

// a card's progress, as kept in state.json: the answers so far (seen, correct, wrong, streak), when it
// was last answered and is next due, and FSRS's memory of it
const PHASES = ["new", "learning", "review", "relearning"]; // FSRS's State, by number
const round = (value) => Math.round(value * 10_000) / 10_000;

function toCard(entry, now) {
  if (!entry) return createEmptyCard(new Date(now));
  return {
    due: new Date(entry.due),
    stability: entry.stability,
    difficulty: entry.difficulty,
    elapsed_days: 0,
    scheduled_days: intervalDays(entry),
    learning_steps: entry.step ?? 0,
    reps: entry.seen,
    lapses: entry.lapses ?? 0,
    state: PHASES.indexOf(entry.phase),
    last_review: new Date(entry.last)
  };
}

// → the card's progress after an answer rated `rating` (see ratingFor) at `now`
export function grade(entry, rating, now = Date.now()) {
  const prev = entry ?? { seen: 0, correct: 0, wrong: 0, streak: 0 };
  // While a card is being learned, Hard repeats the step instead of moving on. Anki leaves that to
  // you, but here a typo or a hint every time would keep the card at 15 minutes all day: the second
  // right answer in a row (streak > 0 while still learning) moves it on, as Good does.
  if (rating === Rating.Hard && entry && entry.phase !== "review" && entry.streak > 0) rating = Rating.Good;
  // a clock set back since the last answer: FSRS can't answer before that, so it's taken as then
  now = Math.max(now, entry?.last ?? now);
  const { card } = scheduler.next(toCard(entry, now), new Date(now), rating);
  const correct = rating !== Rating.Again;
  const phase = PHASES[card.state];
  // a review lands at the same time of day, so a day with a clock change is still one day
  const due = phase === "review" ? daysLater(now, card.scheduled_days) : card.due.getTime();
  return {
    due,
    last: now,
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    wrong: prev.wrong + (correct ? 0 : 1),
    streak: correct ? prev.streak + 1 : 0,
    phase,
    step: card.learning_steps,
    stability: round(card.stability),
    difficulty: round(card.difficulty),
    lapses: card.lapses,
    box: boxFor(phase === "review" ? card.scheduled_days : 0)
  };
}

// Dracosh 0.5 and older read a Leitner `box` on every card before they look at the file's version, so
// one is kept, close to the interval: an older Dracosh then says the file is from a newer version
// instead of calling it damaged. Nothing here reads it.
const boxFor = (days) => Math.max(1, BOX_DAYS.filter((each) => each <= days).length);

// the days between the last answer and the next review (0 while it's still being learned)
export const intervalDays = (entry) => (entry.phase === "review" ? Math.max(0, Math.round((entry.due - entry.last) / DAY)) : 0);
export const isMastered = (entry) => intervalDays(entry) >= MASTERED_DAYS;

// Progress from Dracosh 0.5 and older, kept in Leitner boxes (1 to 5: 1, 3, 7, 14 and 30 days), as
// FSRS's memory of it. A box's interval is what the card was last trusted with, so it becomes the
// stability; the share of misses sets the difficulty, between FSRS's first guess after "Good" and
// after "Again". A card just missed (streak 0) is still relearning. Its due date stays.
const BOX_DAYS = [1, 3, 7, 14, 30];
export function fromBox(entry) {
  const level = Math.min(Math.max(Math.round(entry.box) || 1, 1), BOX_DAYS.length);
  const days = BOX_DAYS[level - 1];
  // a count that isn't a number (a hand-edited file) is taken as none
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const [seen, correct, wrong, streak] = [count(entry.seen), count(entry.correct), count(entry.wrong), count(entry.streak)];
  const missed = Math.min(wrong / Math.max(seen, 1), 1);
  const [easy, hard] = [scheduler.init_difficulty(Rating.Good), scheduler.init_difficulty(Rating.Again)];
  // never answered after it's due: FSRS counts the days between the two
  const last = Number.isFinite(entry.last) ? Math.min(entry.last, entry.due) : entry.due - days * DAY;
  return {
    ...entry,
    seen,
    correct,
    wrong,
    streak,
    last,
    phase: !streak && seen > 0 ? "relearning" : "review",
    step: 0,
    stability: days,
    difficulty: round(easy + (hard - easy) * missed),
    lapses: wrong,
    box: level
  };
}

export function describeDue(entry, now = Date.now()) {
  const ms = entry.due - now;
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  const hours = Math.round(ms / (60 * MINUTE));
  return hours < 24 ? `${hours} h` : `${Math.round(ms / DAY)} d`;
}
