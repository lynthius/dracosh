import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { acquireLock, runningPid } = await import("../src/lock.js");
const LOCK = join(process.env.DRACOSH_HOME, "dracosh.lock");

test("a second window is refused while the first one runs; a lock left by a crash isn't", async () => {
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
  writeFileSync(LOCK, JSON.stringify({ pid: other.pid }));
  assert.equal(runningPid(), other.pid);
  assert.throws(() => acquireLock(), /already running in another window/);
  other.kill();
  await new Promise((resolve) => other.on("exit", resolve));
  assert.equal(runningPid(), null, "that process is gone");
  const release = acquireLock();
  assert.ok(existsSync(LOCK));
  release();
  assert.equal(existsSync(LOCK), false);
});

test("of two windows started at the same moment, only one gets the lock", async () => {
  const { execFileSync, spawn: run } = await import("node:child_process");
  const script = `import(${JSON.stringify(new URL("../src/lock.js", import.meta.url).href)}).then(({ acquireLock }) => { try { acquireLock(); console.log("got it"); setTimeout(() => {}, 800); } catch { console.log("refused"); } });`;
  const outputs = await Promise.all(
    Array.from({ length: 4 }, () => new Promise((resolve) => {
      const child = run(process.execPath, ["--input-type=module", "-e", script], { env: process.env });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("exit", () => resolve(out.trim()));
    }))
  );
  assert.equal(outputs.filter((o) => o === "got it").length, 1, outputs.join(", "));
});
