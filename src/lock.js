import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./store.js";

// One quiz at a time per data folder: each window keeps the progress in memory and saves all of it,
// so two windows would overwrite each other's answers. The lock file holds the running window's pid.
const LOCK_FILE = join(HOME, "dracosh.lock");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // running, but someone else's process
  }
};

// the pid of a Dracosh quiz running on this data folder, or null
export function runningPid() {
  let pid;
  try {
    pid = Number(JSON.parse(readFileSync(LOCK_FILE, "utf8")).pid);
  } catch {
    return null; // no lock, or an unreadable one
  }
  return pid && pid !== process.pid && alive(pid) ? pid : null; // a lock left by a crash doesn't count
}

export const ALREADY_RUNNING = (pid) => `Dracosh is already running in another window (process ${pid}). Close it first: two windows would overwrite each other's progress.`;

// → a release function; throws when another quiz holds the lock. The lock file is created exclusively
// ("wx"), so of two windows started at the same moment only one gets it; a stale one is replaced once.
export function acquireLock() {
  mkdirSync(HOME, { recursive: true });
  const lock = JSON.stringify({ pid: process.pid, since: new Date().toISOString() });
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(LOCK_FILE, lock, { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST" || attempt > 0) throw err.code === "EEXIST" ? new Error(ALREADY_RUNNING(runningPid() ?? "?")) : err;
      const pid = runningPid();
      if (pid) throw new Error(ALREADY_RUNNING(pid));
      rmSync(LOCK_FILE, { force: true }); // left behind by a window that crashed
    }
  }
  const release = () => {
    try {
      if (Number(JSON.parse(readFileSync(LOCK_FILE, "utf8")).pid) === process.pid) rmSync(LOCK_FILE);
    } catch {}
  };
  process.on("exit", release);
  // with the lock held no other window writes here: temp files left by a crash can go
  for (const name of readdirSync(HOME)) if (name.endsWith(".tmp")) rmSync(join(HOME, name), { force: true });
  return release;
}
