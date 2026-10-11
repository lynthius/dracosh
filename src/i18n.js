import { readFileSync } from "node:fs";

// UI text lives in locales/<lang>.json under nested keys, read as "help.title". English is complete;
// any other language may leave keys out, and English fills the gaps.
const load = (lang) => {
  try {
    return JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), "utf8"));
  } catch {
    return null;
  }
};

// the languages Dracosh speaks, each named in its own language for /settings
export const LANGUAGES = { en: "English", pl: "Polski", de: "Deutsch", fr: "Français", uk: "Українська" };

const english = load("en");
let current = { lang: "en", messages: english };

// → the language now in use: the one asked for, or English when there is no such locale file
export function setLanguage(lang) {
  const messages = lang === "en" ? english : load(lang);
  current = messages ? { lang, messages } : { lang: "en", messages: english };
  return current.lang;
}

export const language = () => current.lang;

// The system's language, the way POSIX tools pick it (LC_ALL, then LC_MESSAGES, then LANG), or
// Intl's when none is set; English when Dracosh doesn't speak it.
export function systemLanguage(env = process.env) {
  const set = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((value) => value && !/^(C|POSIX)\b/i.test(value));
  const code = (set ?? Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().slice(0, 2);
  return Object.hasOwn(LANGUAGES, code) ? code : "en";
}

// the locale for dates and times: British English keeps "14 Oct" and a 24-hour clock
export const dateLocale = () => (current.lang === "en" ? "en-GB" : current.lang);

const lookup = (messages, key) => key.split(".").reduce((node, part) => node?.[part], messages);

// a locale entry as it is, for data that isn't a single text (the tour's cards)
export const entry = (key) => lookup(current.messages, key) ?? lookup(english, key);

// Plural text is an object of forms ({ one, few, many, other }); Intl.PluralRules picks the form the
// language uses for `count` (Polish: 1 karta, 2 karty, 5 kart).
function pluralForm(forms, count) {
  return forms[new Intl.PluralRules(current.lang).select(count)] ?? forms.other;
}

// t("help.title"), t("count.cards", { count: 3 }): {placeholders} are filled from `vars`.
// An unknown key comes back as itself, so a missing text shows up instead of crashing.
export function t(key, vars = {}) {
  let text = lookup(current.messages, key) ?? lookup(english, key);
  if (text === undefined) return key;
  if (typeof text === "object") text = pluralForm(text, vars.count ?? 0);
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
}

// every key of a locale, flattened ("help.title"); plural forms and lists count as one key
export const isPlural = (value) => Boolean(value) && typeof value === "object" && "other" in value;
export function keysOf(messages, prefix = "") {
  return Object.entries(messages).flatMap(([name, value]) => {
    const key = prefix ? `${prefix}.${name}` : name;
    return value && typeof value === "object" && !Array.isArray(value) && !isPlural(value) ? keysOf(value, key) : [key];
  });
}

export const englishMessages = () => english;
