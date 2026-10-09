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

const emptyState = () => ({ version: 1, items: {}, newToday: { date: "", count: 0 } });

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
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
    const tmp = `${file}.tmp`;
    await writeFile(tmp, json);
    await rename(tmp, file);
  });
  writes = job.catch(() => {}); // one failed write must not block the next ones
  return job;
}

export const loadLibrary = async () => upgradeLibrary(await readJson(LIBRARY_FILE, null));
export const saveLibrary = (library) => writeJson(LIBRARY_FILE, library);

export const loadState = () => readJson(STATE_FILE, emptyState());
export const saveState = (state) => writeJson(STATE_FILE, state);

export function recordAnswer(state, noteId, direction, entry, now = Date.now()) {
  const key = itemKey(noteId, direction);
  const isNew = !state.items[key];
  const date = dayKey(now);
  state.items[key] = entry;
  if (isNew) state.newToday = { date, count: newToday(state, now) + 1 };
  return state;
}

export const loadSettingsRaw = () => readJson(SETTINGS_FILE, {});

// merges into what's on disk, so a one-off CLI flag never gets persisted by accident
export async function patchSettings(patch) {
  const current = await readJson(SETTINGS_FILE, {});
  await writeJson(SETTINGS_FILE, { ...current, ...patch });
}
