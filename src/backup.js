import { copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { dayKey } from "./dates.js";
import { DATA_FILES, HOME, readJson, writeJson } from "./store.js";

// A backup is one JSON file in ~/.dracosh/backups holding the library, progress and settings as they
// were. One is taken on the first start of each day, and right before anything that changes a lot at
// once (a restore now; imports, deletions and resets later).
export const BACKUP_DIR = join(HOME, "backups");
const BACKUP_FORMAT = 1;
export const KEEP = 7; // per kind: the last 7 daily ones, and the last 7 taken before an operation

// "2026-10-09T21:15:03.120Z" → "2026-10-09_21-15-03", so file names sort by time
const stamp = (now) => new Date(now).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");

// → the file it wrote, or null when there is nothing to back up (or, with `skipDamaged`, when a data file
// is too damaged to read: a backup missing the library would push the good ones out). Otherwise a damaged
// file is set aside as it is (library.json.damaged-<day>, one a day) and the backup goes on, so a
// restore still works.
export async function backupNow(reason, now = Date.now(), { skipDamaged = false } = {}) {
  const files = {};
  for (const [name, file] of Object.entries(DATA_FILES)) {
    try {
      const data = await readJson(file, null);
      if (data) files[name] = data;
    } catch {
      if (skipDamaged) return null;
      await copyFile(file, `${file}.damaged-${dayKey(now)}`);
    }
  }
  if (!Object.keys(files).length) return null;
  const file = join(BACKUP_DIR, `${stamp(now)}-${reason}.json`);
  await writeJson(file, { format: BACKUP_FORMAT, created: now, reason, files });
  await prune();
  return file;
}

async function backupFiles() {
  try {
    return (await readdir(BACKUP_DIR)).filter((name) => name.endsWith(".json")).sort().reverse(); // newest first
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

const isDaily = (name) => name.endsWith("-daily.json");

async function prune() {
  const names = await backupFiles();
  const old = [...names.filter(isDaily).slice(KEEP), ...names.filter((name) => !isDaily(name)).slice(KEEP)];
  await Promise.all(old.map((name) => rm(join(BACKUP_DIR, name), { force: true })));
}

// the first start of a day backs up what the day before left behind
export async function dailyBackup(now = Date.now()) {
  const today = dayKey(now);
  const backups = await listBackups();
  if (backups.some((b) => b.reason === "daily" && dayKey(b.created) === today)) return null;
  return backupNow("daily", now, { skipDamaged: true });
}

// → newest first: { file, created, reason, decks, cards, practiced }
export async function listBackups() {
  const list = [];
  for (const name of await backupFiles()) {
    const file = join(BACKUP_DIR, name);
    const backup = await readJson(file, null).catch(() => null); // a damaged file just isn't offered
    if (backup?.format !== BACKUP_FORMAT || !backup.files || typeof backup.files !== "object") continue;
    const { library, state } = backup.files;
    list.push({
      file,
      created: backup.created,
      reason: backup.reason,
      decks: library?.decks?.length ?? 0,
      cards: library?.cards?.length ?? 0,
      practiced: Object.keys(state?.items ?? {}).length
    });
  }
  return list.sort((a, b) => b.created - a.created); // file names only go down to the second
}

// Puts a backup's files back. What's there now is backed up first, so a restore can be undone too.
// A file the backup doesn't have is left as it is: a restore never deletes your cards or progress.
export async function restoreBackup(file, now = Date.now()) {
  const backup = await readJson(file, null);
  if (backup?.format !== BACKUP_FORMAT || !backup.files) throw new Error(`${file} isn't a Dracosh backup.`);
  await backupNow("before-restore", now);
  for (const [name, target] of Object.entries(DATA_FILES)) {
    if (backup.files[name]) await writeJson(target, backup.files[name]);
  }
}
