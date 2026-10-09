export const DEFAULTS = { everyMs: 600_000, sound: true, volume: 0.5, dailyGoal: 20, directions: "both", tips: "always", quiet: null, skipWeekends: true, deck: null };

export const INTERVALS = [60_000, 120_000, 300_000, 600_000, 900_000, 1_200_000, 1_800_000, 2_700_000, 3_600_000];
export const GOALS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
export const VOLUMES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const TIP_MODES = ["always", "sometimes", "off"];
export const TIP_LABELS = { always: "always", sometimes: "sometimes (1 in 3 waits)", off: "off" };
// presets for /settings; any { from, to } in settings.json works too
export const QUIET_PRESETS = [null, { from: 21, to: 7 }, { from: 22, to: 8 }, { from: 23, to: 7 }, { from: 0, to: 8 }];
export const DIRECTION_OPTIONS = ["both", "en-pl", "pl-en"];

export const DIRECTION_LABELS = { both: "EN ⇄ PL", "en-pl": "EN → PL only", "pl-en": "PL → EN only" };

export function formatInterval(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

// older versions saved tips as a boolean
const normalizeTips = (value) => (value === true ? "always" : value === false ? "off" : TIP_MODES.includes(value) ? value : DEFAULTS.tips);

const isHour = (v) => Number.isInteger(v) && v >= 0 && v <= 23;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// settings.json is hand-editable, so anything invalid falls back to the default instead of crashing
export function normalizeSettings(raw = {}) {
  return {
    everyMs: isNumber(raw.everyMs) && raw.everyMs >= 1000 ? raw.everyMs : DEFAULTS.everyMs,
    sound: typeof raw.sound === "boolean" ? raw.sound : DEFAULTS.sound,
    volume: isNumber(raw.volume) && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULTS.volume,
    dailyGoal: isNumber(raw.dailyGoal) && raw.dailyGoal >= 1 ? Math.round(raw.dailyGoal) : DEFAULTS.dailyGoal,
    directions: DIRECTION_OPTIONS.includes(raw.directions) ? raw.directions : DEFAULTS.directions,
    tips: normalizeTips(raw.tips),
    skipWeekends: typeof raw.skipWeekends === "boolean" ? raw.skipWeekends : DEFAULTS.skipWeekends,
    quiet: raw.quiet && isHour(raw.quiet.from) && isHour(raw.quiet.to) ? { from: raw.quiet.from, to: raw.quiet.to } : null,
    deck: typeof raw.deck === "string" && raw.deck.trim() ? raw.deck : null // picked in /decks; null = your first deck
  };
}

export function directionsFor(setting) {
  return setting === "en-pl" ? ["en-pl"] : setting === "pl-en" ? ["pl-en"] : ["en-pl", "pl-en"];
}
