import { t } from "./i18n.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dayKey } from "./dates.js";
import { upgradeLibrary } from "./library.js";
import { fromBox, itemKey, newToday } from "./scheduler.js";

export const HOME = process.env.DRACOSH_HOME || join(homedir(), ".dracosh");
const LIBRARY_FILE = join(HOME, "library.json");
const STATE_FILE = join(HOME, "state.json");
const SETTINGS_FILE = join(HOME, "settings.json");
// everything a backup holds, by name
export const DATA_FILES = { library: LIBRARY_FILE, state: STATE_FILE, settings: SETTINGS_FILE };

// 1: Leitner boxes (Dracosh 0.5 and older); 2: FSRS
export const STATE_VERSION = 2;
const emptyState = () => ({ version: STATE_VERSION, items: {}, newToday: { date: "", count: 0 } });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// what to say when a data file can't be used as it is
// marked, not only worded: the message is in the app's language
export const damaged = (file, why) => Object.assign(new Error(t("errors.damaged", { file, why })), { damaged: true });

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    if (err instanceof SyntaxError) throw damaged(file, err.message);
    throw new Error(t("errors.cantRead", { file, error: err.message }));
  }
}

// Writes are queued (one at a time) and go through write-then-rename: a crash mid-write can't corrupt the file,
// and two saves in quick succession (an answer and a shown tip, say) can't trip over each other's temp file.
let writes = Promise.resolve();

export function writeJson(file, data) {
  const json = JSON.stringify(data, null, 2); // snapshot now: the state object keeps changing
  const job = writes.then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`; // another Dracosh process never shares it
    await writeFile(tmp, json);
    await rename(tmp, file);
  });
  writes = job.catch(() => {}); // one failed write must not block the next ones
  return job;
}

export async function loadLibrary() {
  try {
    return upgradeLibrary(await readJson(LIBRARY_FILE, undefined));
  } catch (err) {
    throw err.damaged ? damaged(LIBRARY_FILE, err.message) : err;
  }
}
export const saveLibrary = (library) => writeJson(LIBRARY_FILE, library);

// Progress, checked for the shape the quiz relies on; a file from a newer Dracosh is never overwritten.
// An older one is brought up to date in memory, `upgraded` saying so: it's written with the next save,
// once a backup holds the file as it was (see upgradeState).
export async function loadState() {
  const state = await readJson(STATE_FILE, undefined);
  if (state === undefined) return emptyState();
  checkState(state, STATE_FILE);
  if (!isObject(state.newToday)) state.newToday = { date: "", count: 0 };
  return upgradeState(state);
}

// progress of an older version → this one's (the same object); `upgraded` (not saved) says it changed
export function upgradeState(state) {
  if ((state.version ?? 1) >= STATE_VERSION) return state;
  for (const [key, entry] of Object.entries(state.items)) if (!("phase" in entry)) state.items[key] = fromBox(entry);
  state.version = STATE_VERSION;
  Object.defineProperty(state, "upgraded", { value: true, enumerable: false });
  return state;
}

// a card's progress: Leitner's box in version 1, FSRS's memory since 2
const PHASES = new Set(["learning", "review", "relearning"]);
const fsrsEntry = (entry) => PHASES.has(entry.phase) && entry.stability > 0 && entry.difficulty > 0 && Number.isFinite(entry.last) && Number.isFinite(entry.seen);
const validEntry = (entry, version) => isObject(entry) && Number.isFinite(entry.due) && (fsrsEntry(entry) || (version < 2 && Number.isFinite(entry.box)));

// throws when `state` (read from `file`) isn't progress the quiz can use
export function checkState(state, file = STATE_FILE) {
  if (!isObject(state) || !isObject(state.items)) throw damaged(file, t("errors.why.noProgress"));
  // a newer Dracosh's progress may look different: said as that, not as damage
  if (state.version > STATE_VERSION) throw new Error(t("errors.newerState", { file }));
  if (!Object.values(state.items).every((entry) => validEntry(entry, state.version ?? 1))) throw damaged(file, t("errors.why.progressEntry"));
  const { progress } = state;
  const validProgress =
    isObject(progress) &&
    isObject(progress.days) &&
    Object.values(progress.days).every(isObject) &&
    isObject(progress.streak) &&
    ["count", "best", "freezes"].every((key) => Number.isFinite(progress.streak[key])) &&
    isObject(progress.badges) &&
    (progress.vacations === undefined || Array.isArray(progress.vacations));
  if (progress !== undefined && !validProgress) throw damaged(file, t("errors.why.streak"));
}
export const saveState = (state) => writeJson(STATE_FILE, state);

// `countNew: false` keeps a card out of the daily cap on new cards (the tour's don't use it up)
export function recordAnswer(state, noteId, direction, entry, now = Date.now(), { countNew = true } = {}) {
  const key = itemKey(noteId, direction);
  // a new card counts once towards the daily limit, whichever way it's asked first
  const isNew = countNew && !state.items[key] && !Object.keys(state.items).some((k) => k.startsWith(`${noteId}:`));
  const date = dayKey(now);
  state.items[key] = entry;
  if (isNew) state.newToday = { date, count: newToday(state, now) + 1 };
  return state;
}

// hand-edited into something odd, even broken JSON: the defaults take over (nothing worth a restore)
export const loadSettingsRaw = async () => {
  const raw = await readJson(SETTINGS_FILE, {}).catch((err) => (err.damaged ? {} : Promise.reject(err)));
  return isObject(raw) ? raw : {};
};

// merges into what's on disk, so a one-off CLI flag never gets persisted by accident
export async function patchSettings(patch) {
  const current = await loadSettingsRaw();
  await writeJson(SETTINGS_FILE, { ...current, ...patch });
}
