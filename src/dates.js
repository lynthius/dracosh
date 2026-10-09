// Calendar days as local "YYYY-MM-DD" keys. Noon avoids DST edge cases when doing day arithmetic.
export const dayKey = (now) => new Date(now).toLocaleDateString("sv");

const parse = (key) => new Date(`${key}T12:00:00`);

export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 86_400_000);

export function addDays(key, n) {
  const date = parse(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

// Monday of the week containing `key`
export const weekStart = (key) => addDays(key, -((parse(key).getDay() + 6) % 7));
