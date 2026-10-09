import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// HOME is read when the module loads, so point it at a temp folder first (each test file runs in its own process)
process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { loadState, saveState } = await import("../src/store.js");

test("many saves in quick succession all succeed and the last one wins", async () => {
  const state = { version: 1, items: {}, newToday: { date: "", count: 0 }, n: 0 };
  const saves = [];
  for (let i = 1; i <= 25; i++) {
    state.n = i;
    saves.push(saveState(state));
  }
  await Promise.all(saves); // no ENOENT from a shared temp file
  assert.equal((await loadState()).n, 25);
});

test("a save snapshots the state at the moment it is called", async () => {
  const state = { version: 1, items: {}, newToday: { date: "", count: 0 }, n: 1 };
  const pending = saveState(state);
  state.n = 2; // changed after the call, before the write happened
  await pending;
  assert.equal((await loadState()).n, 1);
});
