import { addDays, daysBetween } from "./dates.js";

const MAX_DAYS = 120; // a typo like "2062" shouldn't switch the streak off for years

export const formatDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const formatRange = (from, to) => (from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`);

// a real calendar date as "YYYY-MM-DD", or null ("31.02" and the like)
function valid(key) {
  const date = new Date(`${key}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString("sv") === key ? key : null;
}

// "2026-12-24", "24.12.2026", or "24.12" (the next 24 December on or after today)
function parseDate(text, today) {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return valid(text);
  const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(text);
  if (!dotted) return null;
  const [, day, month, year] = dotted;
  if (year) return valid(`${year}-${pad(month)}-${pad(day)}`);
  const thisYear = Number(today.slice(0, 4));
  const key = valid(`${thisYear}-${pad(month)}-${pad(day)}`);
  return key && key < today ? valid(`${thisYear + 1}-${pad(month)}-${pad(day)}`) : key;
}

// days-off arguments (see /pause in pause.js) → { action: "list" } | { action: "off" } | { action: "add", from, to } | null (not understood)
//   ""            list what is planned
//   "off"         cancel current and future vacations
//   "7" / "7d"    7 days starting today
//   "24.12 2.01"  a range (also "24.12..2.01", "2026-12-24 to 2027-01-02"); a single date means one day
export function parseVacation(args, today) {
  const text = args.trim().toLowerCase();
  if (!text) return { action: "list" };
  if (["off", "cancel", "clear"].includes(text)) return { action: "off" };

  const days = /^(\d+)\s*d?$/.exec(text);
  if (days) {
    const n = Number(days[1]);
    return n >= 1 && n <= MAX_DAYS ? { action: "add", from: today, to: addDays(today, n - 1) } : null;
  }

  const parts = text.split(/\s+|\.\.|\bto\b/).filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const dates = parts.map((part) => parseDate(part, today));
  if (dates.some((date) => !date)) return null;
  const [a, b = a] = dates;
  // A day and month without a year means the next one to come, so a range that already started
  // ("28.12 3.01" on 30 December, "24.12 2.01" on New Year's Day) gets its start back a year.
  // Of the readings that make sense, the shortest wins; a reversed range is read the other way round.
  const back = (key, part) => (/^\d{1,2}\.\d{1,2}$/.test(part) ? valid(`${Number(key.slice(0, 4)) - 1}${key.slice(4)}`) : null);
  const readings = [[a, b], [back(a, parts[0]), b], [b, a]].filter(([x, y]) => x && y && x <= y);
  const [from, to] = readings.sort(([x1, y1], [x2, y2]) => daysBetween(x1, y1) - daysBetween(x2, y2))[0];
  return daysBetween(from, to) < MAX_DAYS ? { action: "add", from, to } : null;
}
