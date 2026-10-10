import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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

// → a release function; throws when another quiz holds the lock
export function acquireLock() {
  const pid = runningPid();
  if (pid) throw new Error(ALREADY_RUNNING(pid));
  mkdirSync(HOME, { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
  const release = () => {
    try {
      if (Number(JSON.parse(readFileSync(LOCK_FILE, "utf8")).pid) === process.pid) rmSync(LOCK_FILE);
    } catch {}
  };
  process.on("exit", release);
  return release;
}
