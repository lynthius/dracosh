import { parseSnooze } from "./quiet.js";
import { parseVacation } from "./vacation.js";

export const PAUSE_HELP = "Try /pause 30m, /pause 2h, /pause 3d or /pause 24.12 2.01";

// "/pause" arguments, one command for a short break and for days off:
//   ""                     → { action: "list" }       what's paused or planned
//   "off"                  → { action: "off" }        questions back, days off cancelled
//   "30m", "2h", "90s"     → { action: "snooze", ms } a break today; the streak isn't touched
//   "3d", "24.12 2.01"…    → { action: "days", from, to } days off that keep your streak
// A bare number is refused: "30" could mean minutes or days. → null when not understood.
export function parsePause(args, today) {
  const text = args.trim().toLowerCase();
  if (!text) return { action: "list" };
  if (["off", "cancel", "clear"].includes(text)) return { action: "off" };
  if (/^\d+(\.\d+)?$/.test(text)) return null;
  if (/^\d+(\.\d+)?\s*(s|m|h)$/.test(text)) {
    const ms = parseSnooze(text);
    return typeof ms === "number" ? { action: "snooze", ms } : null;
  }
  const days = parseVacation(text, today);
  return days?.action === "add" ? { action: "days", from: days.from, to: days.to } : null;
}
