import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { DATA_FILES, loadLibrary, loadSettingsRaw, loadState } = await import("../src/store.js");
const { normalizeSettings } = await import("../src/settings.js");

test("damaged data files say so and point to dracosh restore", async () => {
  const cases = [
    [DATA_FILES.library, '{"version":1,"decks":[', loadLibrary],
    [DATA_FILES.library, "null", loadLibrary],
    [DATA_FILES.library, '{"decks":"x"}', loadLibrary],
    [DATA_FILES.state, "{}", loadState],
    [DATA_FILES.state, '{"items":null}', loadState],
    [DATA_FILES.state, "null", loadState]
  ];
  for (const [file, text, load] of cases) {
    writeFileSync(file, text);
    await assert.rejects(load(), /looks damaged.*dracosh restore/, text);
  }
});

test("a state file from a newer Dracosh is refused", async () => {
  writeFileSync(DATA_FILES.state, JSON.stringify({ version: 99, items: {} }));
  await assert.rejects(loadState(), /newer version/);
});

test("odd settings fall back to the defaults", async () => {
  writeFileSync(DATA_FILES.settings, "null");
  assert.deepEqual(await loadSettingsRaw(), {});
  assert.equal(normalizeSettings(null).everyMs, 600_000);
});

test("state with broken entries or progress, and cards with no answer or no deck, are reported too", async () => {
  for (const text of ['{"items":{"a:en-pl":null}}', '{"items":{},"progress":5}', '{"items":{},"progress":{}}']) {
    writeFileSync(DATA_FILES.state, text);
    await assert.rejects(loadState(), /looks damaged/, text);
  }
  writeFileSync(DATA_FILES.library, JSON.stringify({ version: 1, decks: [{ id: "d1", name: "A" }], cards: [{ id: "c1", deckId: "d1", front: "x", back: [] }] }));
  await assert.rejects(loadLibrary(), /looks damaged/);
  writeFileSync(DATA_FILES.library, JSON.stringify({ version: 1, decks: [{ id: "d1", name: "A" }], cards: [{ id: "c1", deckId: "d9", front: "x", back: ["y"] }] }));
  await assert.rejects(loadLibrary(), /looks damaged/);
  writeFileSync(DATA_FILES.settings, "{ not json");
  assert.deepEqual(await loadSettingsRaw(), {}, "broken settings just mean the defaults");
});
