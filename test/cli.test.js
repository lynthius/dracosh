import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = new URL("../src/cli.js", import.meta.url).pathname;
const run = (home, ...args) => execFileSync(process.execPath, [CLI, ...args], { env: { ...process.env, DRACOSH_HOME: home }, encoding: "utf8" });

test("--data shows where everything lives, and creates nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const out = run(home, "--data");
  assert.match(out, new RegExp(`keeps everything in ${home}`));
  assert.match(out, /library\.json.*not created yet/);
  assert.match(out, /backups\/\s+none yet/);
  assert.equal(existsSync(join(home, "library.json")), false, "just looking never writes");
});
