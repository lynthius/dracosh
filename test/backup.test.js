import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { DATA_FILES, loadLibrary, loadState, saveLibrary, saveState, patchSettings } = await import("../src/store.js");
const { backupNow, dailyBackup, KEEP, listBackups, restoreBackup } = await import("../src/backup.js");
const { addCard, createDeck } = await import("../src/library.js");

const DAY = 86_400_000;
const start = new Date("2026-03-01T10:00:00").getTime();

test("nothing to back up on a fresh install", async () => {
  assert.equal(await dailyBackup(start), null);
  assert.deepEqual(await listBackups(), []);
});

test("one daily backup per day, holding the library, progress and settings", async () => {
  const library = await loadLibrary();
  const deck = createDeck(library, { name: "Spanish" });
  addCard(library, deck.id, { front: "gato", back: ["cat"] });
  await saveLibrary(library);
  await saveState({ version: 1, items: { [`${library.cards[0].id}:en-pl`]: { box: 2 } }, newToday: { date: "", count: 0 } });
  await patchSettings({ volume: 0.3 });

  assert.ok(await dailyBackup(start));
  assert.equal(await dailyBackup(start + 3_600_000), null, "not twice on the same day");
  const [backup] = await listBackups();
  assert.deepEqual({ reason: backup.reason, decks: backup.decks, cards: backup.cards, practiced: backup.practiced }, { reason: "daily", decks: 1, cards: 1, practiced: 1 });
});

test("only the last daily backups are kept", async () => {
  for (let day = 1; day <= KEEP + 3; day++) await dailyBackup(start + day * DAY);
  const daily = (await listBackups()).filter((b) => b.reason === "daily");
  assert.equal(daily.length, KEEP);
  assert.equal(daily[0].created, start + (KEEP + 3) * DAY, "newest first");
});

test("a restore brings everything back, and can itself be undone", async () => {
  const [before] = await listBackups();
  const library = await loadLibrary();
  library.cards = [];
  await saveLibrary(library);
  await saveState({ version: 1, items: {}, newToday: { date: "", count: 0 } });

  await restoreBackup(before.file, start + 20 * DAY);
  assert.equal((await loadLibrary()).cards.length, 1);
  assert.equal(Object.keys((await loadState()).items).length, 1);

  const undo = (await listBackups()).find((b) => b.reason === "before-restore");
  assert.equal(undo.cards, 0, "what was there right before the restore");
});

test("a file that didn't exist back then is removed on restore", async () => {
  const file = await backupNow("test", start + 30 * DAY);
  const { readJson, writeJson } = await import("../src/store.js");
  const backup = await readJson(file);
  delete backup.files.settings;
  await writeJson(file, backup);
  await restoreBackup(file, start + 31 * DAY);
  assert.equal(existsSync(DATA_FILES.settings), false);
});
