import { dayKey } from "./dates.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Leitner boxes: a correct answer moves the word one box up; a miss sends it back to box 1
export const BOX_INTERVALS_DAYS = [1, 3, 7, 14, 30];
export const RELEARN_DELAY = 10 * MINUTE;
export const NEW_PER_DAY = 20;

export const DIRECTIONS = ["en-pl", "pl-en"];
export const itemKey = (noteId, direction) => `${noteId}:${direction}`;

export function newToday(state, now) {
  return state.newToday?.date === dayKey(now) ? state.newToday.count : 0;
}

const NEW_RATIO = 0.3; // when both due and unseen items exist, this share of questions introduces a new one
const EXTRA_PRACTICE_POOL = 10; // with nothing due, practice one of the next few upcoming items
const MAX_OVERDUE_WEIGHT_DAYS = 3;
const SOLO_DUE_MIX = 0.35; // how often a lone due card yields to other material instead of repeating

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
// Never asks the same note twice in a row when there is any alternative.
export function pickNext({ words, state, now = Date.now(), lastNoteId = null, directions = DIRECTIONS, random = Math.random }) {
  const candidates = words.flatMap((word) => directions.map((direction) => ({ word, direction, entry: state.items[itemKey(word.noteId, direction)] })));
  if (!candidates.length) return null;

  const pool = candidates.some((c) => c.word.noteId !== lastNoteId) ? candidates.filter((c) => c.word.noteId !== lastNoteId) : candidates;

  const due = pool.filter((c) => c.entry && c.entry.due <= now);
  const unseen = pool.filter((c) => !c.entry);
  const canIntroduce = unseen.length > 0 && newToday(state, now) < NEW_PER_DAY;

  if (due.length && canIntroduce && random() < NEW_RATIO) return pickRandom(unseen, random);

  // A single due card is usually a word you keep missing (back every RELEARN_DELAY): if it were always
  // picked, every session would open with the same word and a miss would loop it forever. Sometimes
  // practise something else instead and come back to it a question later.
  if (due.length === 1 && random() < SOLO_DUE_MIX) {
    const others = pool.filter((c) => c.entry && c.word.noteId !== due[0].word.noteId).sort((a, b) => a.entry.due - b.entry.due).slice(0, EXTRA_PRACTICE_POOL);
    if (others.length) return pickRandom(others, random);
    if (canIntroduce) return pickRandom(unseen, random);
  }

  if (due.length) return pickDue(due, now, random);
  if (canIntroduce) return pickRandom(unseen, random);

  const upcoming = pool.filter((c) => c.entry).sort((a, b) => a.entry.due - b.entry.due).slice(0, EXTRA_PRACTICE_POOL);
  return upcoming.length ? pickRandom(upcoming, random) : pickRandom(unseen, random) ?? null;
}

// → the updated entry (pure; caller stores it). A correct answer given with a hint counts, but doesn't move up a box.
export function grade(entry, correct, now = Date.now(), { hinted = false } = {}) {
  const prev = entry ?? { box: 0, seen: 0, correct: 0, wrong: 0, streak: 0 };
  if (correct) {
    const box = hinted ? Math.max(prev.box, 1) : Math.min(prev.box + 1, BOX_INTERVALS_DAYS.length);
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
