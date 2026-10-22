import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = new URL("../src/cli.js", import.meta.url).pathname;
const run = (home, ...args) => execFileSync(process.execPath, [CLI, ...args], { env: { ...process.env, DRACOSH_HOME: home, LC_ALL: "", LC_MESSAGES: "", LANG: "en_US.UTF-8" }, encoding: "utf8" });

test("--data shows where everything lives, and creates nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const out = run(home, "--data");
  assert.match(out, new RegExp(`keeps everything in ${home}`));
  assert.match(out, /library\.json.*not created yet/);
  assert.match(out, /backups\/\s+none yet/);
  assert.equal(existsSync(join(home, "library.json")), false, "just looking never writes");
});

test("--stats reads progress from Dracosh 0.5 as FSRS sees it, and leaves the file as it was", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const day = 86_400_000;
  const now = Date.now();
  const entry = (box, days, wrong = 0) => ({ box, due: now + days * day, last: now, seen: 3, correct: 3 - wrong, wrong, streak: wrong ? 0 : 3 });
  const v1 = JSON.stringify({ version: 1, items: { "a:en-pl": entry(5, 30), "b:en-pl": entry(3, 7), "c:en-pl": entry(2, 3), "d:en-pl": entry(1, 0.01, 1) }, newToday: { date: "", count: 0 } });
  writeFileSync(join(home, "state.json"), v1);
  const out = run(home, "--stats");
  assert.match(out, /4 cards practised, 11\/12 correct/);
  assert.match(out, /learning: 1 · under a week: 1 · under a month: 1 · a month or more: 1/);
  assert.match(out, /1 cards? mastered/);
  assert.equal(readFileSync(join(home, "state.json"), "utf8"), v1, "only the quiz saves it, after a backup");
});
