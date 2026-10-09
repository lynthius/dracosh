const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// quiet = { from, to } in whole hours (22 → 8 means 22:00 until 08:00, past midnight), or null for no quiet hours
export function inQuietHours(ms, quiet) {
  if (!quiet || quiet.from === quiet.to) return false;
  const hour = new Date(ms).getHours();
  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to;
}

// the next moment quiet hours end after `ms`
export function quietEnd(ms, quiet) {
  const end = new Date(ms);
  end.setHours(quiet.to, 0, 0, 0);
  if (end.getTime() <= ms) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export const formatQuiet = (quiet) => (quiet ? `${String(quiet.from).padStart(2, "0")}:00–${String(quiet.to).padStart(2, "0")}:00` : "off");

// "/snooze" → 1 h, "30", "30m", "2h", "90s" → milliseconds, "off" → "off", anything else → null
export function parseSnooze(arg) {
  const text = arg.trim().toLowerCase();
  if (!text) return HOUR;
  if (text === "off" || text === "0") return "off";
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]) * { s: 1000, m: MINUTE, h: HOUR }[match[2] ?? "m"];
  return amount > 0 ? amount : null;
}

export const formatClock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
