// A deck's languages: what its front and back are written in (ISO 639-1 codes). Guessed from the
// cards until you set them in /decks; a side that can't be told stays unknown and gets the general
// answer checking. "und" (undetermined) is a side you said isn't any one language.

import { language, LANGUAGES as UI_LANGUAGES } from "./i18n.js";

export const UNKNOWN = "und";
// languages whose articles show the gender: where "almost" checks them
export const GENDERED_LANGUAGES = ["de", "fr", "es", "it", "pt", "ca", "nl", "sv", "da", "no", "nb", "nn"];
export const isKnown = (code) => Boolean(code) && code !== UNKNOWN;

// the languages offered in /decks, most learned first; any other ISO 639-1 code still works if typed
export const DECK_LANGUAGES = [
  "en", "es", "de", "fr", "it", "pt", "pl", "nl", "sv", "da", "no", "fi", "cs", "sk", "hu", "ro", "hr", "sl", "sr",
  "bg", "uk", "ru", "be", "el", "tr", "lt", "lv", "et", "is", "ga", "ca", "eu", "la", "eo", "ja", "zh", "ko", "ar",
  "he", "fa", "hi", "th", "vi", "id", "ka", "hy"
];

// "es" → "Spanish" (in the UI's language: "hiszpański"; languageName("es", "es") is "español"); an
// unknown side → null
const namers = new Map(); // one Intl.DisplayNames per UI language: making one is slow
export function languageName(code, ui = language()) {
  if (!code || code === UNKNOWN) return null;
  try {
    if (!namers.has(ui)) namers.set(ui, new Intl.DisplayNames([ui], { type: "language" }));
    return namers.get(ui).of(code) ?? code;
  } catch {
    return code;
  }
}

// Scripts that tell the language (nearly) on their own. Han alone could be Chinese or Japanese
// (Japanese writes many words in kanji only): it takes kana to say Japanese, and characters only
// simplified Chinese uses to say Chinese.
const SCRIPTS = [
  ["ko", /\p{Script=Hangul}/u],
  ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["zh", /\p{Script=Han}/u],
  ["el", /\p{Script=Greek}/u],
  ["he", /\p{Script=Hebrew}/u],
  ["ar", /\p{Script=Arabic}/u],
  ["hi", /\p{Script=Devanagari}/u],
  ["th", /\p{Script=Thai}/u],
  ["ka", /\p{Script=Georgian}/u],
  ["hy", /\p{Script=Armenian}/u]
];
const SIMPLIFIED = /[们这说对时么车东见语长书爱电话马鸟鱼风飞龙门问间关开头买卖钱银红绿蓝网谢请习颜脑饭汤鸡]/u;
const PERSIAN = /[پچژگ]/u;
const URDU = /[ٹڈڑںےھہ]/u;

// Letters that point to a language: [language, letters, weight]. Strong ones (3 and up) are (nearly)
// only used there; weak ones are shared by a few languages and only tip the balance.
const STRONG = 3;
const LETTERS = [
  ["pl", "ąęłśźżń", 3], ["pl", "ćó", 1],
  ["de", "ß", 4], ["de", "äöü", 1],
  ["fr", "œùûÿ", 3], ["fr", "çèêëîïôàâé", 1],
  ["es", "ñ¿¡", 4], ["es", "áíóúé", 1],
  ["pt", "ãõ", 4], ["pt", "çâêôáéíóú", 1],
  ["it", "ìò", 3], ["it", "àèéù", 1],
  ["cs", "řěů", 4], ["cs", "čšžýáíéú", 1],
  ["sk", "ľĺŕ", 4], ["sk", "ô", 2], ["sk", "äčšžýáíéú", 1],
  ["hu", "őű", 4], ["hu", "áéíóöúü", 1],
  ["ro", "ășțşţ", 4], ["ro", "âî", 1],
  ["tr", "ğış", 4], ["tr", "çöü", 1],
  ["sv", "å", 2], ["sv", "äö", 1],
  ["da", "æø", 2], ["da", "å", 1],
  ["no", "æø", 2], ["no", "å", 1],
  ["fi", "äö", 1],
  ["hr", "đ", 3], ["hr", "čćšž", 1],
  ["sl", "čšž", 1],
  ["lt", "ėįų", 4], ["lt", "ąčęšūž", 1],
  ["lv", "āēīūģķļņ", 4], ["lv", "čšž", 1],
  ["et", "õ", 2], ["et", "äöü", 1],
  ["is", "þð", 4], ["is", "æáéíóúý", 1],
  ["ca", "·", 4], ["ca", "çàèòéíóú", 1],
  ["vi", "ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ", 3],
  // Cyrillic: plain Cyrillic words are left unguessed, only letters a language owns count
  ["uk", "їєґ", 4], ["uk", "і", 2],
  ["be", "ў", 4], ["be", "і", 1],
  ["ru", "ыэё", 3],
  ["bg", "ъ", 3],
  ["sr", "јљњћђџ", 4],
  ["mk", "ѓќѕ", 4]
];

// Short words every sentence has: a few matches tell languages that share their letters apart
const WORDS = {
  en: "the a an and of in is are you i it this that with for not my your be have do what",
  de: "der die das und ist nicht ein eine ich du sie es mit zu den dem auf für wir",
  fr: "le la les et est un une des je tu il elle pas de du que qui avec pour nous vous",
  es: "el la los las lo y es un una que de no yo tú en con por para está son muy",
  it: "il lo la gli e è un una di che non io tu con per sono mi ti",
  pt: "o a os as e é um uma de que não eu você em com por para do da são",
  nl: "de het een en is niet ik jij je van met op dat zijn wat",
  pl: "i w się nie jest na że z do co jak ja ty mi być",
  sv: "och är en ett att det jag du inte på med som för",
  da: "og er en et at det jeg du ikke på med som for",
  no: "og er en ei et å det jeg du ikke på med som for eg ikkje ein",
  fi: "ja on se minä sinä että mutta kanssa olla",
  cs: "a je se v na že s jsem není ten",
  sk: "a je sa v na že som nie aj ako sú",
  hr: "je i u na da se ne sam su što kako",
  ro: "și este un o de în nu eu cu pe la să ce mai",
  tr: "ve bir bu ne ben sen için ile değil var",
  ru: "и в не на что это я ты он она с как",
  uk: "і в не на що це я ти він вона з як та але й",
  bg: "и в не на е съм се да за от ще аз ти",
  be: "і ў не на што гэта я ты ён яна з як"
};
// a word shared by several languages ("la", "de") counts for each of them a little
const WORD_LANGS = new Map();
for (const [lang, list] of Object.entries(WORDS)) for (const word of list.split(" ")) WORD_LANGS.set(word, [...(WORD_LANGS.get(word) ?? []), lang]);
const WORD_POINTS = 3;

// Spellings typical of a language, in words of plain letters ("the", "szkoła", "Schule")
const SPELLINGS = [
  ["en", /th|wh|ght|ing$|ck$/],
  ["de", /sch|tz|ung$/],
  ["nl", /ij|aa|uu|oe/],
  ["pl", /sz|cz|rz|ść/],
  ["hu", /gy|zs/],
  ["hr", /ije|lj|nj/],
  ["it", /tt|zz|gli|cch|zion|zie/],
  ["fr", /eau|eux|oi[rstx]/],
  ["es", /ción/],
  ["pt", /ção|nh|lh/],
  ["fi", /ää|yy|yö|nen$|ss[aä]$/],
  ["bg", /ът$|ят$/],
  ["be", /дз/]
];
// elisions: "l'" is French, Italian and Catalan; "qu'", "j'", "n'"… are French
const ELISION = /^(l|qu|j|n|s|c|m|t|d)['’]/;

const MIN_SCORE = 3;
const PLAIN_ENGLISH = 5; // cards
const MARGIN = 1.5; // the winner needs more than half again the runner-up's score
// English words rarely end in a, i, o or u; Polish, Czech, Italian, Spanish or Finnish written
// without accents often do. Nor do they have these letter pairs.
const NOT_ENGLISH = /sz|cz|rz|ij|gy|zs/;

// → { script, scores }: a script that names the language on its own, or each language's points
// with the texts that gave any (one stray word, like Polish "las", doesn't make a deck Spanish)
function scoresOf(texts) {
  const all = texts.map((one) => String(one ?? "").normalize("NFC").toLowerCase());
  const text = all.join(" ");
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return { all, text, letters, scores: new Map() };
  for (const [lang, pattern] of SCRIPTS) {
    const share = letters.filter((ch) => pattern.test(ch)).length / letters.length;
    if (share <= 0.3) continue;
    if (lang === "zh") return { all, text, letters, script: SCRIPTS[1][1].test(text) ? "ja" : SIMPLIFIED.test(text) ? "zh" : null };
    if (lang === "ar") return { all, text, letters, script: URDU.test(text) ? null : PERSIAN.test(text) ? "fa" : "ar" };
    return { all, text, letters, script: lang };
  }

  const scores = new Map();
  const add = (lang, points, from, strong = false) => {
    const score = scores.get(lang) ?? { points: 0, texts: new Set(), hits: 0, strong: false };
    score.points += points;
    score.texts.add(from);
    score.hits += 1;
    score.strong ||= strong;
    scores.set(lang, score);
  };
  all.forEach((one, from) => {
    for (const ch of one) for (const [lang, set, weight] of LETTERS) if (set.includes(ch)) add(lang, weight, from, weight >= STRONG);
    if (/^to \p{L}+$/u.test(one.trim())) add("en", 2, from); // "to go": an English verb (Polish "to dom" isn't one word)
    for (const word of one.split(/[^\p{L}'’]+/u).filter(Boolean)) {
      const bare = word.replace(ELISION, "");
      const langs = WORD_LANGS.get(word) ?? WORD_LANGS.get(bare) ?? [];
      for (const lang of langs) add(lang, WORD_POINTS / langs.length, from);
      if (bare !== word) for (const lang of /^l['’]/.test(word) ? ["fr", "it", "ca"] : ["fr"]) add(lang, /^l['’]/.test(word) ? 0.5 : 1, from);
      for (const [lang, pattern] of SPELLINGS) if (pattern.test(bare)) add(lang, 1, from);
    }
  });
  // Russian has none of these letters, Belarusian has ы and э as well
  if (/[іїєґўјљњћђџѓќѕ]/u.test(text)) scores.delete("ru");
  return { all, text, letters, scores };
}

// → the language most of these texts are written in, or null when they don't say: better unknown
// than wrong (one plain word like "kot" could be many languages)
export function guessLanguage(texts) {
  const { all, text, letters, script, scores } = scoresOf(texts);
  if (script !== undefined) return script;
  if (!letters.length) return null;

  const ranked = [...scores].sort((a, b) => b[1].points - a[1].points);
  const [best, second] = ranked;
  if (!best || best[0] === "en") {
    // plain a-z on many cards and nothing pointing elsewhere: English, by far the most learned language
    const words = text.split(/[^a-z]+/).filter((word) => word.length >= 3);
    const vowelEnds = words.filter((word) => /[aiou]$/.test(word)).length;
    const plain = /^[a-z\s\p{P}\p{N}]+$/u.test(text) && !words.some((word) => NOT_ENGLISH.test(word));
    if (plain && all.length >= PLAIN_ENGLISH && words.length >= PLAIN_ENGLISH && vowelEnds < words.length * 0.4) return "en";
  }
  if (!best || best[1].points < MIN_SCORE) return null;
  // one card has to say it clearly: a letter only that language has, or two hints
  if (all.length === 1 ? !best[1].strong && best[1].hits < 2 : best[1].texts.size < 2) return null;
  if (second && best[1].points <= second[1].points * MARGIN) return null;
  return best[0];
}

// how strongly these texts point to one language (0: not at all)
function pointsFor(texts, lang) {
  const { script, scores } = scoresOf(texts);
  if (script !== undefined) return script === lang ? 10 : 0;
  return scores.get(lang)?.points ?? 0;
}

// the most points any language gets from these texts
function strongest(texts) {
  const { script, scores } = scoresOf(texts);
  if (script !== undefined) return script ? 10 : 0; // kanji alone: a script, but no one language yet
  return Math.max(0, ...[...scores.values()].map((score) => score.points));
}

// The script a language is written in; Latin for the rest
const WRITTEN_IN = {
  Cyrillic: ["ru", "uk", "be", "bg", "sr", "mk"], Greek: ["el"], Han: ["zh", "ja"], Hiragana: ["ja"], Katakana: ["ja"], Hangul: ["ko"],
  Arabic: ["ar", "fa"], Hebrew: ["he"], Devanagari: ["hi"], Thai: ["th"], Georgian: ["ka"], Armenian: ["hy"]
};
const SCRIPT_TESTS = Object.keys(WRITTEN_IN).map((name) => [name, new RegExp(`\\p{Script=${name}}`, "u")]);
function scriptOf(texts) {
  const letters = [...texts.join(" ")].filter((ch) => /\p{L}/u.test(ch));
  const counts = new Map();
  for (const ch of letters) {
    const script = SCRIPT_TESTS.find(([, test]) => test.test(ch))?.[0] ?? (/\p{Script=Latin}/u.test(ch) ? "Latin" : null);
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
// can these texts be in this language at all: Latin "kot" is never Ukrainian, Cyrillic never Polish
function writtenIn(lang, texts) {
  const script = scriptOf(texts);
  if (!script) return false;
  const scripts = Object.entries(WRITTEN_IN).filter(([, langs]) => langs.includes(lang)).map(([name]) => name);
  return script === "Latin" ? scripts.length === 0 || lang === "sr" : scripts.includes(script);
}

// other words people name a language deck with
const NAME_ALIASES = { mandarin: "zh", mandaryński: "zh", mandarynski: "zh", farsi: "fa", cantonese: "zh", flemish: "nl", bokmal: "no", nynorsk: "no" };

const fold = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").toLowerCase();

// The languages a deck is named after, in the order the name gives them: "Hiszpański" → ["es"],
// "Polish to German" → ["pl", "de"], "Español", "Німецька A1". Names are read in every language
// Dracosh speaks, whatever the UI's, and in the language itself.
export function languagesInName(name, ui = language()) {
  const words = fold(String(name ?? "")).split(/[^\p{L}]+/u).filter(Boolean);
  const found = [];
  words.forEach((word, at) => {
    for (const code of DECK_LANGUAGES) {
      const names = [...new Set([ui, ...Object.keys(UI_LANGUAGES), code])].map((name) => languageName(code, name));
      if ((names.some((one) => one && fold(one) === word) || NAME_ALIASES[word] === code) && !found.some((f) => f.code === code)) found.push({ code, at });
    }
  });
  return found.sort((a, b) => a.at - b.at).map((f) => f.code);
}
export const languageInName = (name, ui = language()) => languagesInName(name, ui)[0] ?? null;

const SAMPLE_CARDS = 200; // enough to tell, and cheap to read before every question
const SAMPLE_LENGTH = 300; // characters of each side of a card: long answers say no more

// What a person's own language seems to be, from outside the deck → [{ code, sure }], likeliest first: the
// one most of their other language decks share (sure), then Dracosh's language and the system's, which
// are only hints (plenty of people run both in English and speak something else)
export function homeLanguages({ others = [], ui = language(), system = systemLocale() } = {}) {
  const counts = new Map();
  for (const pair of others) for (const code of new Set([pair.front, pair.back].filter(isKnown))) counts.set(code, (counts.get(code) ?? 0) + 1);
  const shared = [...counts].filter(([, n]) => n >= 2 && n > others.length / 2).sort((a, b) => b[1] - a[1]).map(([code]) => code);
  const hints = [ui, system].filter((code) => code && !shared.includes(code));
  return [...shared.map((code) => ({ code, sure: true })), ...[...new Set(hints)].map((code) => ({ code, sure: false }))];
}
const systemLocale = () => {
  const set = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG].find((v) => v && !/^(C|POSIX)\b/i.test(v));
  return (set ?? Intl.DateTimeFormat().resolvedOptions().locale).slice(0, 2).toLowerCase();
};

// The language you're learning in a deck → { side: "front" | "back", lang, sure }, or null for a deck
// that isn't for a language (one language on both sides, like definitions, or none known). Your own
// choice (deck.learning, a language code) wins; else, in turn: the language the deck is named after
// ("Chiński", "Polish to German": the second); the side that isn't your own language (homeLanguages);
// a lone known side that isn't yours; and last the back, as cards usually go "word you know = new
// word", though that's only a guess (`sure: false`), so the app asks. Pronunciation reads that
// language and "almost" applies to it.
export function learningSide(languages, deck, home = homeLanguages()) {
  const { front, back } = languages ?? {};
  const known = [front, back].filter(isKnown);
  if (!known.length || front === back) return null;
  const pick = (side, sure = true) => ({ side, lang: side === "front" ? front : back, sure });
  if (deck?.learning && deck.learning === front) return pick("front");
  if (deck?.learning && deck.learning === back) return pick("back");
  const mine = home.map((h) => (typeof h === "string" ? { code: h, sure: true } : h)); // (a plain code is sure)
  if (known.length === 2) {
    const named = languagesInName(deck?.name).filter((code) => code === front || code === back);
    if (named.length) return pick(named.at(-1) === front ? "front" : "back"); // "X to Y": Y
    const own = mine.find((h) => h.code === front || h.code === back);
    if (own) return pick(own.code === front ? "back" : "front", own.sure);
    return pick("back", false);
  }
  // one side known (the other couldn't be told yet): learn it, unless it's yours; a guess either way
  const own = mine.find((h) => h.code === known[0]);
  return own?.sure ? null : own ? null : pick(isKnown(front) ? "front" : "back", false);
}

// → { front, back, guessed }: the languages you set, else the ones the cards suggest. A side the cards
// don't tell may come from the deck's name ("Hiszpański", "Polish to German") or, when its cards
// show a sign of it, from the language you use Dracosh in. A guess has to fit the side's script, and
// when nothing points either way the side stays unknown: better unknown than wrong. A cloze card's
// front is a sentence in the front language; its back is only a hint, so it isn't guessed from.
export function deckLanguages(deck, cards = [], ui = language()) {
  if (deck?.languages) return { front: deck.languages.front, back: deck.languages.back, guessed: false };
  try {
    return guessDeck(deck, cards, ui);
  } catch {
    return { front: UNKNOWN, back: UNKNOWN, guessed: true }; // a guess is never worth a crash
  }
}

function guessDeck(deck, cards, ui) {
  const some = cards.slice(0, SAMPLE_CARDS);
  const text = (value) => String(value ?? "").slice(0, SAMPLE_LENGTH);
  const fronts = some.map((card) => text(card.front).replace(/\{\{|\}\}/g, ""));
  const backs = some.filter((card) => !card.cloze).flatMap((card) => (Array.isArray(card.back) ? card.back : [card.back]).map(text));
  const sides = { front: fronts, back: backs };
  const found = { front: fronts.length ? guessLanguage(fronts) : null, back: backs.length ? guessLanguage(backs) : null };

  // a language the side's cards could be in: the right script, and nothing pointing elsewhere
  const fits = (lang, side) => sides[side].length > 0 && writtenIn(lang, sides[side]) && pointsFor(sides[side], lang) >= strongest(sides[side]) - 1;
  const named = languagesInName(deck?.name, ui);
  const open = (side) => !found[side];
  const other = (side) => (side === "front" ? "back" : "front");

  if (named.length >= 2 && open("front") && open("back")) {
    const [a, b] = named;
    const asIs = pointsFor(fronts, a) + pointsFor(backs, b);
    const turned = pointsFor(fronts, b) + pointsFor(backs, a);
    const [front, back] = turned > asIs ? [b, a] : [a, b];
    if (fits(front, "front") && fits(back, "back")) Object.assign(found, { front, back });
  }
  // twice round: a side filled in on the way may be what the other one needed ("English" with a Polish back)
  for (const side of ["front", "back", "front"]) {
    if (!open(side)) continue;
    const taken = found[other(side)];
    // the deck's language goes where the cards lean to it, or opposite a side known to be another one
    // (with two in the name, the one the other side isn't)
    const byName = named.find((lang) => lang !== taken && fits(lang, side) && (pointsFor(sides[side], lang) > 0 || (taken && (!named.includes(taken) || named.length >= 2))));
    if (byName) found[side] = byName;
    // your own language, where the cards show some sign of it
    else if (ui !== taken && fits(ui, side) && pointsFor(sides[side], ui) > 0) found[side] = ui;
  }
  return { front: found.front ?? UNKNOWN, back: found.back ?? UNKNOWN, guessed: true };
}
