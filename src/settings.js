import { LANGUAGES, systemLanguage, t } from "./i18n.js";

export const DEFAULTS = { everyMs: 600_000, rhythm: "minutes", sound: true, speak: false, volume: 0.5, dailyGoal: 20, tips: "sometimes", quiet: null, skipWeekends: true, deck: null, homeLanguage: null, learningLanguage: null };

export const INTERVALS = [60_000, 120_000, 300_000, 600_000, 900_000, 1_200_000, 1_800_000, 2_700_000, 3_600_000];
export const GOALS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
export const VOLUMES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const TIP_MODES = ["always", "sometimes", "off"];
// how cards come: one every few minutes (everyMs), or a session where Enter asks the next one right
// away, endless or for a set number of cards, after which the minutes take over again
export const RHYTHMS = ["minutes", "session", "session-10", "session-20"];
export const sessionLength = (rhythm) => (rhythm.startsWith("session-") ? Number(rhythm.slice("session-".length)) : null);
// presets for /settings; any { from, to } in settings.json works too
export const QUIET_PRESETS = [null, { from: 21, to: 7 }, { from: 22, to: 8 }, { from: 23, to: 7 }, { from: 0, to: 8 }];

export function formatInterval(ms) {
  if (ms < 60_000) return t("time.seconds", { n: Math.round(ms / 1000) });
  if (ms < 3_600_000) return t("time.minutes", { n: Math.round(ms / 60_000) });
  return t("time.hours", { n: Math.round(ms / 3_600_000) });
}

// older versions saved tips as a boolean
const normalizeTips = (value) => (value === true ? "always" : value === false ? "off" : TIP_MODES.includes(value) ? value : DEFAULTS.tips);

const isHour = (v) => Number.isInteger(v) && v >= 0 && v <= 23;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isLanguage = (v) => typeof v === "string" && /^[a-z]{2,3}$/.test(v);

// settings.json is hand-editable, so anything invalid falls back to the default instead of crashing
export function normalizeSettings(raw = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  return {
    everyMs: isNumber(raw.everyMs) && raw.everyMs >= 1000 ? raw.everyMs : DEFAULTS.everyMs,
    rhythm: RHYTHMS.includes(raw.rhythm) ? raw.rhythm : DEFAULTS.rhythm,
    sound: typeof raw.sound === "boolean" ? raw.sound : DEFAULTS.sound,
    speak: typeof raw.speak === "boolean" ? raw.speak : DEFAULTS.speak,
    volume: isNumber(raw.volume) && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULTS.volume,
    dailyGoal: isNumber(raw.dailyGoal) && raw.dailyGoal >= 1 ? Math.round(raw.dailyGoal) : DEFAULTS.dailyGoal,
    tips: normalizeTips(raw.tips),
    skipWeekends: typeof raw.skipWeekends === "boolean" ? raw.skipWeekends : DEFAULTS.skipWeekends,
    quiet: raw.quiet && isHour(raw.quiet.from) && isHour(raw.quiet.to) ? { from: raw.quiet.from, to: raw.quiet.to } : null,
    deck: typeof raw.deck === "string" && raw.deck.trim() ? raw.deck : null, // picked in /decks; null = your first deck
    // the language you speak and the one you're learning, from the welcome (codes; null: not said)
    homeLanguage: isLanguage(raw.homeLanguage) ? raw.homeLanguage : null,
    learningLanguage: isLanguage(raw.learningLanguage) ? raw.learningLanguage : null,
    language: typeof raw.language === "string" && Object.hasOwn(LANGUAGES, raw.language) ? raw.language : systemLanguage() // until picked in /settings, the system's
  };
}

