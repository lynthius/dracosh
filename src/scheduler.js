import { dayKey } from "./dates.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Leitner boxes: a correct answer moves the card one box up; a miss sends it back to box 1
export const BOX_INTERVALS_DAYS = [1, 3, 7, 14, 30];
export const RELEARN_DELAY = 10 * MINUTE;
export const NEW_PER_DAY = 20;

export const DIRECTIONS = ["en-pl", "pl-en"];
export const itemKey = (noteId, direction) => `${noteId}:${direction}`;

export function newToday(state, now) {
  return state.newToday?.date === dayKey(now) ? state.newToday.count : 0;
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

// Mixes due reviews with new words (up to the daily cap), at random; with nothing to do, practises a soon-due item.
// Never asks the same note twice in a row when there is any alternative. A `tour` deck is different:
// each card is asked once, in deck order, and never comes back as a review (null when it's done).
// What to ask next: a due review or a new card (up to the daily cap), mixed at random; null when there
// is nothing to do right now. Cards are never asked before they're due: answering early would move them
// up the boxes without the spacing that makes them stick. Never the same note twice in a row while
// anything else is waiting. A `tour` deck is different: each card is asked once, in deck order, and
// never comes back as a review.
export function pickNext({ words, state, now = Date.now(), lastNoteId = null, directions = DIRECTIONS, tour = false, random = Math.random }) {
  const candidates = words.flatMap((word) => directions.map((direction) => ({ word, direction, entry: state.items[itemKey(word.noteId, direction)] })));
  if (tour) return candidates.find((c) => !c.entry) ?? null;

  const canIntroduce = newToday(state, now) < NEW_PER_DAY;
  const waiting = candidates.filter((c) => (c.entry ? c.entry.due <= now : canIntroduce));
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
    for (const direction of directions) {
      const entry = state.items[itemKey(word.noteId, direction)];
      const at = entry ? entry.due : startOfTomorrow(now);
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

export function grade(entry, correct, now = Date.now(), { hinted = false } = {}) {
  const prev = entry ?? { box: 0, seen: 0, correct: 0, wrong: 0, streak: 0 };
  if (correct) {
    // right after a miss the card starts over at box 1 (back tomorrow) instead of skipping ahead
    const relearning = prev.seen > 0 && prev.streak === 0;
    const box = hinted || relearning ? Math.max(prev.box, 1) : Math.min(prev.box + 1, BOX_INTERVALS_DAYS.length);
    return { ...prev, box, due: now + BOX_INTERVALS_DAYS[box - 1] * DAY, seen: prev.seen + 1, correct: prev.correct + 1, streak: prev.streak + 1, last: now };
  }
  return { ...prev, box: 1, due: now + RELEARN_DELAY, seen: prev.seen + 1, wrong: prev.wrong + 1, streak: 0, last: now };
}

export function describeDue(entry, now = Date.now()) {
  const ms = entry.due - now;
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  const hours = Math.round(ms / (60 * MINUTE));
  return hours < 24 ? `${hours} h` : `${Math.round(ms / DAY)} d`;
}
