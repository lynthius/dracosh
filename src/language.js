// A deck's languages: what its front and back are written in (ISO 639-1 codes). Guessed from the
// cards until you set them in /decks; a side that can't be told stays unknown and gets the general
// answer checking. "und" (undetermined) is a side you said isn't any one language.

import { language } from "./i18n.js";

export const UNKNOWN = "und";
export const isKnown = (code) => Boolean(code) && code !== UNKNOWN;

// the languages offered in /decks, most learned first; any other ISO 639-1 code still works if typed
export const DECK_LANGUAGES = [
  "en", "es", "de", "fr", "it", "pt", "pl", "nl", "sv", "da", "no", "fi", "cs", "sk", "hu", "ro", "hr", "sl", "sr",
  "bg", "uk", "ru", "be", "el", "tr", "lt", "lv", "et", "is", "ga", "ca", "eu", "la", "eo", "ja", "zh", "ko", "ar",
  "he", "fa", "hi", "th", "vi", "id", "ka", "hy"
];

// "es" → "Spanish" (in the UI's language: "hiszpański"); an unknown side → null
export function languageName(code, ui = language()) {
  if (!code || code === UNKNOWN) return null;
  try {
    return new Intl.DisplayNames([ui], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Scripts that tell the language (nearly) on their own
const SCRIPTS = [
  ["ko", /\p{Script=Hangul}/u],
  ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["zh", /\p{Script=Han}/u],
  ["el", /\p{Script=Greek}/u],
  ["he", /\p{Script=Hebrew}/u],
  ["fa", /[پچژگ]/u],
  ["ar", /\p{Script=Arabic}/u],
  ["hi", /\p{Script=Devanagari}/u],
  ["th", /\p{Script=Thai}/u],
  ["ka", /\p{Script=Georgian}/u],
  ["hy", /\p{Script=Armenian}/u]
];

// Letters that point to a language: [language, letters, weight]. Strong ones are (nearly) only used
// there; weak ones are shared by a few languages and only tip the balance.
const LETTERS = [
  ["pl", "ąęłśźżćń", 3], ["pl", "ó", 1],
  ["de", "ß", 4], ["de", "äöü", 1],
  ["fr", "œùûÿ", 3], ["fr", "çèêëîïôàâé", 1],
  ["es", "ñ¿¡", 4], ["es", "áíóúé", 1],
  ["pt", "ãõ", 4], ["pt", "çâêôáéíóú", 1],
  ["it", "ìò", 3], ["it", "àèéù", 1],
  ["cs", "řěů", 4], ["cs", "čšžýáíéú", 1],
  ["sk", "ľĺŕ", 4], ["sk", "ôäčšžýáí", 1],
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
  // Cyrillic
  ["uk", "їєґ", 4], ["uk", "і", 2],
  ["be", "ў", 4], ["be", "і", 1],
  ["ru", "ыэё", 3], ["ru", "ъ", 1],
  ["bg", "ъ", 2],
  ["sr", "јљњћђџ", 4]
];

// Short words every sentence has: a few matches tell languages that share their letters apart
const WORDS = {
  en: "the a an and of to in is are you i it this that with for not my your be have do what",
  de: "der die das und ist nicht ein eine ich du sie es mit zu den dem ein auf für wir",
  fr: "le la les et est un une des je tu il elle pas de du que qui avec pour nous vous",
  es: "el la los las y es un una que de no yo tú en con por para está son muy",
  it: "il lo la gli e è un una di che non io tu con per sono mi ti",
  pt: "o a os as e é um uma de que não eu você em com para do da são",
  nl: "de het een en is niet ik jij je van met op dat zijn wat",
  pl: "i w się nie jest to na że z do co jak ja ty mi być",
  sv: "och är en ett att det jag du inte på med som för",
  da: "og er en et at det jeg du ikke på med som for",
  no: "og er en et å det jeg du ikke på med som for",
  fi: "ja on ei se minä sinä että mutta kanssa olla",
  cs: "a je se v na to že s jsem není ten",
  ro: "și este un o de în nu eu cu pe la",
  tr: "ve bir bu ne ben sen için ile değil var",
  ru: "и в не на что это я ты он она с как",
  uk: "і в не на що це я ти він вона з як"
};
// a word shared by several languages ("la", "de") counts for each of them a little
const WORD_LANGS = new Map();
for (const [lang, list] of Object.entries(WORDS)) for (const word of list.split(" ")) WORD_LANGS.set(word, [...(WORD_LANGS.get(word) ?? []), lang]);
const WORD_POINTS = 3;

// Spellings typical of a language, in words of plain letters ("the", "szkoła", "Schule")
const SPELLINGS = [
  ["en", /th|wh|ght|ing$|ck$/],
  ["de", /sch|tz|ung$|ß/],
  ["nl", /ij|aa|uu|oe/],
  ["pl", /sz|cz|rz|dz|ść/],
  ["it", /tt|zz|gli|cch|zion|zie/],
  ["fr", /eau|eux|oi|qu'/],
  ["es", /ción|ll|rr/],
  ["pt", /ção|nh|lh/]
];

const MIN_SCORE = 3;
const PLAIN_ENGLISH = 5; // cards
const MARGIN = 1.5; // the winner needs half again the runner-up's score

// → the language most of these texts are written in, or null when they don't say (one plain word
// like "kot" could be many languages)
export function guessLanguage(texts) {
  const all = texts.map((one) => one.normalize("NFC").toLowerCase());
  const text = all.join(" ");
  if (!text.trim()) return null;

  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return null;
  for (const [lang, pattern] of SCRIPTS) {
    const share = letters.filter((ch) => pattern.test(ch)).length / letters.length;
    if (share > 0.3) return lang === "zh" && SCRIPTS[1][1].test(text) ? "ja" : lang;
  }

  // each language's points, and how many of the texts gave any: one stray word ("las" is Polish
  // for forest, and Spanish for "the") doesn't make a deck Spanish
  const scores = new Map();
  const add = (lang, points, from) => {
    const score = scores.get(lang) ?? { points: 0, texts: new Set() };
    score.points += points;
    score.texts.add(from);
    scores.set(lang, score);
  };
  all.forEach((one, from) => {
    for (const ch of one) for (const [lang, set, weight] of LETTERS) if (set.includes(ch)) add(lang, weight, from);
    for (const word of one.split(/[^\p{L}'’]+/u).filter(Boolean)) {
      const bare = word.replace(/^(l|d|qu|j|n|s|c|m|t)['’]/, ""); // l'école → école
      const langs = WORD_LANGS.get(word) ?? WORD_LANGS.get(bare) ?? [];
      for (const lang of langs) add(lang, WORD_POINTS / langs.length, from);
      if (bare !== word) add("fr", 1, from);
      for (const [lang, pattern] of SPELLINGS) if (pattern.test(bare)) add(lang, 1, from);
      // Cyrillic with none of the letters Ukrainian, Belarusian, Serbian or Bulgarian have: likely Russian
      if (/^\p{Script=Cyrillic}+$/u.test(word) && !/[іїєґўјљњћђџъ]/u.test(word)) add("ru", 0.5, from);
    }
  });

  const ranked = [...scores].sort((a, b) => b[1].points - a[1].points);
  const [best, second] = ranked;
  // plain a-z on many cards and nothing pointing elsewhere: English, by far the most learned language
  if ((!best || best[1].texts.size < 2) && all.length >= PLAIN_ENGLISH && /^[a-z\s\p{P}\p{N}]+$/u.test(text)) return "en";
  if (!best || best[1].points < MIN_SCORE || (all.length > 1 && best[1].texts.size < 2)) return null;
  if (second && best[1].points < second[1].points * MARGIN) return null;
  return best[0];
}

// → { front, back, guessed }: the languages you set, else the ones the cards suggest. A cloze card's
// front is a sentence in the front language; its back is only a hint, so it's left out of the guess.
export function deckLanguages(deck, cards) {
  if (deck?.languages) return { front: deck.languages.front, back: deck.languages.back, guessed: false };
  const fronts = cards.map((card) => card.front.replace(/\{\{|\}\}/g, ""));
  const backs = cards.filter((card) => !card.cloze).flatMap((card) => card.back);
  return { front: guessLanguage(fronts) ?? UNKNOWN, back: guessLanguage(backs) ?? UNKNOWN, guessed: true };
}
