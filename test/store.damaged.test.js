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
