import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dayKey } from "./dates.js";
import { upgradeLibrary } from "./library.js";
import { itemKey, newToday } from "./scheduler.js";

export const HOME = process.env.DRACOSH_HOME || join(homedir(), ".dracosh");
const LIBRARY_FILE = join(HOME, "library.json");
const STATE_FILE = join(HOME, "state.json");
const SETTINGS_FILE = join(HOME, "settings.json");
// everything a backup holds, by name
export const DATA_FILES = { library: LIBRARY_FILE, state: STATE_FILE, settings: SETTINGS_FILE };

export const STATE_VERSION = 1;
const emptyState = () => ({ version: STATE_VERSION, items: {}, newToday: { date: "", count: 0 } });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// what to say when a data file can't be used as it is
export const damaged = (file, why) => new Error(`${file} looks damaged (${why}). Run "dracosh restore" to bring back a backup.`);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    if (err instanceof SyntaxError) throw damaged(file, err.message);
    throw new Error(`Can't read ${file}: ${err.message}`);
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

// Progress, checked for the shape the quiz relies on; a file from a newer Dracosh is never overwritten
export async function loadState() {
  const state = await readJson(STATE_FILE, undefined);
  if (state === undefined) return emptyState();
  if (!isObject(state) || !isObject(state.items)) throw damaged(STATE_FILE, "no progress in it");
  if (!Object.values(state.items).every((entry) => isObject(entry) && Number.isFinite(entry.box) && Number.isFinite(entry.due))) throw damaged(STATE_FILE, "a card without its box or date");
  const { progress } = state;
  if (progress !== undefined && !(isObject(progress) && isObject(progress.days) && isObject(progress.streak) && isObject(progress.badges))) throw damaged(STATE_FILE, "the streak and badges are unreadable");
  if (state.version > STATE_VERSION) throw new Error(`${STATE_FILE} was saved by a newer version of Dracosh. Please update Dracosh.`);
  if (!isObject(state.newToday)) state.newToday = { date: "", count: 0 };
  return state;
}
export const saveState = (state) => writeJson(STATE_FILE, state);

// `countNew: false` keeps a card out of the daily cap on new cards (the tour's don't use it up)
export function recordAnswer(state, noteId, direction, entry, now = Date.now(), { countNew = true } = {}) {
  const key = itemKey(noteId, direction);
  const isNew = countNew && !state.items[key];
  const date = dayKey(now);
  state.items[key] = entry;
  if (isNew) state.newToday = { date, count: newToday(state, now) + 1 };
  return state;
}

// hand-edited into something odd, even broken JSON: the defaults take over (nothing worth a restore)
export const loadSettingsRaw = async () => {
  const raw = await readJson(SETTINGS_FILE, {}).catch((err) => (err.message.includes("looks damaged") ? {} : Promise.reject(err)));
  return isObject(raw) ? raw : {};
};

// merges into what's on disk, so a one-off CLI flag never gets persisted by accident
export async function patchSettings(patch) {
  const current = await loadSettingsRaw();
  await writeJson(SETTINGS_FILE, { ...current, ...patch });
}
