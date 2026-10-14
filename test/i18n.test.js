import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { englishMessages, isPlural, keysOf, LANGUAGES, setLanguage, systemLanguage, t } from "../src/i18n.js";
import { judge } from "../src/judge.js";
import { BADGES, ELEMENTS, STAGES } from "../src/progress.js";
import { TIPS } from "../src/tips.js";
import { RHYTHMS } from "../src/settings.js";

const english = englishMessages();
const known = new Set(keysOf(english));

// every source file, read as text: the keys it passes to t() (or `say`, its other name in session.js)
const sources = (dir) =>
  readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(`${dir}${entry.name}/`) : entry.name.endsWith(".js") ? [readFileSync(new URL(`${dir}${entry.name}`, import.meta.url), "utf8")] : []
  );
const code = sources("../src/").join("\n");
const staticKeys = [...code.matchAll(/\b(?:t|say)\("([\w.-]+)"/g)].map((match) => match[1]);
// keys picked in a condition, like t(ok ? "a.yes" : "a.no"): any quoted key in the code counts as used
const quotedKeys = [...code.matchAll(/"([\w-]+(?:\.[\w-]+)+)"/g)].map((match) => match[1]).filter((key) => known.has(key));

// keys built at run time from ids, so they can't be found in the code as text
const dynamicKeys = [
  ...BADGES.flatMap((badge) => [`badges.${badge.id}.name`, `badges.${badge.id}.desc`]),
  ...STAGES.map((stage) => `dragon.stages.${stage.id}`),
  ...ELEMENTS.flatMap((element) => [`dragon.elements.${element}.name`, `dragon.elements.${element}.adjective`]),
  ...TIPS.flatMap((tip) => [`tips.${tip.id}.cat`, `tips.${tip.id}.text`]),
  "tour.deck",
  "tour.cards",
  ...["language", "rhythm", "everyMs", "sound", "volume", "dailyGoal", "tips", "skipWeekends", "quiet", "reset"].flatMap((row) => [`settings.rows.${row}.label`, `settings.rows.${row}.hint`]),
  ...RHYTHMS.map((rhythm) => `settings.rhythms.${rhythm}`),
  ...["always", "sometimes", "off"].map((mode) => `settings.tipModes.${mode}`),
  ...["deck", "line", "back"].flatMap((field) => [`add.fields.${field}.label`, `add.fields.${field}.hint`]),
  ...["noBack", "noFront", "slash", "inDeck", "twice"].map((issue) => `add.paste.issues.${issue}`),
  ...["article", "umlaut"].map((reason) => `quiz.almost.${reason}`),
  ...["progress", "everything"].flatMap((scope) => ["label", "note", "question", "stays", "yes"].map((part) => `reset.${scope}.${part}`)),
  ...["cards", "progress", "settings"].map((part) => `cli.restore.what.${part}`),
  ...["daily", "before-reset", "before-delete", "before-restore"].map((reason) => `cli.restore.reasons.${reason}`),
  ...["idle", "smile", "happy", "sad", "blink", "sleep"].map((face) => `preview.faces.${face}`),
  ...Object.keys(english.preview.scenes).flatMap((id) => [`preview.scenes.${id}.label`, `preview.scenes.${id}.hint`]),
  ...Object.keys(english.commands).map((name) => `commands.${name}`)
];

test("every text the code asks for is in locales/en.json", () => {
  const missing = [...new Set([...staticKeys, ...dynamicKeys])].filter((key) => !known.has(key));
  assert.deepEqual(missing, []);
});

test("locales/en.json has no texts that nothing uses", () => {
  const used = new Set([...staticKeys, ...quotedKeys, ...dynamicKeys]);
  assert.deepEqual([...known].filter((key) => !used.has(key)), []);
});

test("placeholders are filled, plurals follow the count, unknown keys show themselves", () => {
  assert.equal(t("count.cards", { count: 1 }), "1 card");
  assert.equal(t("count.cards", { count: 5 }), "5 cards");
  assert.equal(t("add.fixed", { front: "kot" }), '"kot" fixed.');
  assert.equal(t("add.paste.added", { count: 3, deck: "Polish" }), "Added 3 cards to Polish.");
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(t("help.title", { unused: 1 }), "Help");
});

test("a language without a locale file falls back to English", () => {
  assert.equal(setLanguage("xx"), "en");
  assert.equal(t("help.title"), "Help");
});

test("plural forms are complete: every plural has at least one and other", () => {
  const plurals = [];
  const walk = (node, path) => {
    for (const [name, value] of Object.entries(node)) {
      if (value && typeof value === "object") ("other" in value ? plurals.push([`${path}${name}`, value]) : walk(value, `${path}${name}.`));
    }
  };
  walk(english, "");
  for (const [key, forms] of plurals) assert.ok(forms.one && forms.other, key);
  assert.ok(plurals.length > 0);
});

const locale = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), "utf8"));
const entries = (messages, prefix = "") =>
  Object.entries(messages).flatMap(([name, value]) => {
    const key = prefix ? `${prefix}.${name}` : name;
    return value && typeof value === "object" && !Array.isArray(value) && !isPlural(value) ? entries(value, key) : [[key, value]];
  });
const placeholders = (value) => [...new Set(JSON.stringify(value).match(/\{\w+\}/g) ?? [])].sort();
const translations = Object.keys(LANGUAGES).filter((lang) => lang !== "en");

for (const lang of translations) {
  test(`locales/${lang}.json has every English key and nothing else`, () => {
    const keys = new Set(keysOf(locale(lang)));
    assert.deepEqual([...known].filter((key) => !keys.has(key)), [], "missing");
    assert.deepEqual([...keys].filter((key) => !known.has(key)), [], "unknown");
  });

  test(`locales/${lang}.json fills the same placeholders as English, with every plural form ${lang} needs`, () => {
    const english = new Map(entries(englishMessages()));
    const forms = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    for (const [key, value] of entries(locale(lang))) {
      if (key === "tour.cards") continue;
      assert.deepEqual(placeholders(value), placeholders(english.get(key)), key);
      // a text may become a plural in a language that needs one, when it is given a count
      if (isPlural(value)) {
        assert.ok(placeholders(english.get(key)).includes("{count}"), `${key}: a plural needs {count}`);
        for (const form of forms) assert.ok(typeof value[form] === "string", `${key}: no "${form}" form`);
      } else assert.equal(typeof value, typeof english.get(key), key);
    }
  });
}

test("the tour works in every language: what a card says to type is accepted, the wrong answer isn't", () => {
  for (const lang of Object.keys(LANGUAGES)) {
    const cards = locale(lang).tour.cards;
    assert.equal(cards.length, englishMessages().tour.cards.length, lang);
    cards.forEach((card, i) => {
      const typed = [...card.front.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((text) => !text.startsWith("/"));
      assert.ok(card.back.length && card.back.every((answer) => !answer.startsWith("/")), `${lang} ${i}`);
      assert.ok(typed.length, `${lang} ${i}: nothing to type`);
      // the fifth card is the one to get wrong on purpose; the second asks for a typo
      if (i === 4) assert.equal(judge(typed[0], card.back), "wrong", `${lang} ${i}`);
      else assert.notEqual(judge(typed[0], card.back), "wrong", `${lang} ${i}: ${typed[0]}`);
      if (i === 1) assert.equal(judge(typed[1], card.back), "typo", `${lang} ${i}: ${typed[1]}`);
    });
  }
});

test("Dracosh speaks the system's language when it can", () => {
  assert.equal(systemLanguage({ LANG: "pl_PL.UTF-8" }), "pl");
  assert.equal(systemLanguage({ LC_ALL: "de_DE.UTF-8", LANG: "pl_PL.UTF-8" }), "de");
  assert.equal(systemLanguage({ LC_ALL: "C", LANG: "uk_UA.UTF-8" }), "uk");
  assert.equal(systemLanguage({ LANG: "ja_JP.UTF-8" }), "en");
});

test("Polish plurals pick the right form", () => {
  setLanguage("pl");
  try {
    assert.deepEqual([1, 2, 5, 22, 25].map((count) => t("count.cards", { count })), ["1 karta", "2 karty", "5 kart", "22 karty", "25 kart"]);
  } finally {
    setLanguage("en");
  }
});
