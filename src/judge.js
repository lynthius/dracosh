// Typos are forgiven only on longer answers: on short words one edit often makes a different word
const TYPO_MIN_LENGTH = 6;

// Sentence punctuation that never changes what an answer means ("Hello, world!" = "hello world").
// Everything else stays: "3.14" isn't "31.4", "-5" isn't "5", "C#" isn't "C", and 🐉 is an answer too.
const LOOSE = /[;!?¡¿"“”„«»()[\]'’ʼʹ`「」『』【】・]/g; // ʼ: the Ukrainian apostrophe (сімʼя)
// full-width letters and signs, as a Japanese or Chinese keyboard types them: "ｎｅｋｏ" is "neko"
const halfWidth = (s) => s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");

// lowercase, loose punctuation dropped, a trailing full stop dropped, hyphens between letters as spaces.
// Commas and colons count between digits only: "3,14" is "3.14" (a decimal comma), "10:30" stays.
function plain(s) {
  const text = s
    .normalize("NFC") // "café" typed or pasted with a separate accent mark is the same word
    .toLowerCase()
    .replace(/[\uff01-\uff5e\u3000]/g, halfWidth)
    .replace(/。/g, ".") // the CJK full stop and comma read like ours
    .replace(/、/g, ",")
    .replace(/(?<=\d),(?=\d)/g, ".")
    .replace(/,/g, " ")
    .replace(/(?<!\d):|:(?!\d)/g, "")
    .replace(LOOSE, "")
    .replace(/(?<=\p{L})[-‐–—](?=\p{L})/gu, " ")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || s.trim().toLowerCase(); // an answer made only of punctuation ("?") is still itself
}

// Letters that don't decompose into a base letter and an accent, spelled the way a keyboard without them would
const SPELLED = { ł: "l", ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ı: "i" };
// й, ї and ў are letters of their own in Ukrainian and Belarusian (on every keyboard there), not и, і, у with an accent
const OWN = { й: "\ue000", ї: "\ue001", ў: "\ue002" };
const OWN_BACK = Object.fromEntries(Object.entries(OWN).map(([letter, mark]) => [mark, letter]));

// Diacritics folded away from lowercase text: "żółw" → "zolw", "straße" → "strasse", "ﬁ" → "fi"
export function fold(s) {
  return s
    .normalize("NFKC")
    .replace(/[йїў]/g, (ch) => OWN[ch])
    .replace(/[łßæœøđðþı]/g, (ch) => SPELLED[ch])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\ue000-\ue002]/g, (ch) => OWN_BACK[ch]);
}

// plain(), and diacritics folded too
export function normalize(s) {
  return fold(plain(s));
}

// Damerau-Levenshtein (optimal string alignment): a swap of two neighbours counts as one edit
export function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

// The candidate the answer came closest to (fewest edits after normalizing): what a miss is diffed against.
// In German "Maedchn" is diffed against "Maedchen", so the spelled-out ä isn't taken for the mistake.
export function closestCandidate(answer, candidates, { lang = null } = {}) {
  const given = normalize(answer);
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates.flatMap((c) => [c, spelledOut(c, lang)])) {
    const distance = editDistance(given, normalize(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// The way a language writes its own letters without them: German "Baer" for "Bär", Danish "aa" for "å".
// Only for answers in that language: in Finnish or Swedish "ae" isn't "ä".
const NORWEGIAN = { æ: "ae", ø: "oe", å: "aa" };
const SPELLED_OUT = { de: { ä: "ae", ö: "oe", ü: "ue" }, da: NORWEGIAN, no: NORWEGIAN, nb: NORWEGIAN, nn: NORWEGIAN };
const spelledOut = (candidate, lang) => {
  const letters = SPELLED_OUT[lang];
  return letters ? candidate.normalize("NFC").replace(/[äöüæøåÄÖÜÆØÅ]/g, (ch) => {
    const out = letters[ch.toLowerCase()];
    return !out ? ch : ch === ch.toLowerCase() ? out : out[0].toUpperCase() + out.slice(1);
  }) : candidate;
};
// the candidate's forms after folding: as written, and spelled out
const spellings = (candidate, lang) => [...new Set([normalize(candidate), normalize(spelledOut(candidate, lang))])];

// Does the answer write the candidate with each such letter kept, spelled out or left plain, as it comes:
// "Gruesse aus Köln" and "Baer und Madchen" both write "Grüße aus Köln", "Bär und Mädchen". → "spelled"
// (every such letter kept or spelled out), "plain" (some left as a plain a, o, u…) or false.
function spelledAnyWay(answer, candidate, lang) {
  const letters = SPELLED_OUT[lang];
  if (!letters) return false;
  // letter by letter, keeping every place the answer could have got to and whether a letter was left
  // plain on the way there: no regex, so a long run of å can't make it slow
  const given = plain(cyrillicLookalikes(answer));
  let at = new Map([[0, false]]);
  for (const ch of plain(candidate)) {
    const ways = letters[ch] ? [[ch, false], [letters[ch], false], [fold(ch), true]] : [[ch, false], [fold(ch), false]];
    const next = new Map();
    for (const [from, leftPlain] of at)
      for (const [way, plainHere] of ways) if (given.startsWith(way, from)) next.set(from + way.length, (next.get(from + way.length) ?? true) && (leftPlain || plainHere));
    if (!next.size) return false;
    at = next;
  }
  return at.has(given.length) ? (at.get(given.length) ? "plain" : "spelled") : false;
}

// German umlauts and articles are what a learner has to get right: an answer without them still counts,
// but as "almost" (the card doesn't move up)
const NO_GENDER = new Set(["to", "att", "at", "å"]); // infinitive markers
// elided or plural articles that don't show the gender, per language
const NO_GENDER_SHOWN = { fr: new Set(["l'", "les", "des", "de l'"]), it: new Set(["l'"]), ca: new Set(["l'"]) };
const GENDERED = new Set(["de", "fr", "es", "it", "pt", "ca", "nl", "sv", "da", "no", "nb", "nn"]);

// Articles (and the infinitive's "to", "att", "å") in front of a word. An answer in that language may
// leave them out or add them, and still counts: "cat" for "the cat", "Hund" for "der Hund". A
// different one counts too, but shows as close, not quite right: "die Hund" for "der Hund".
const ARTICLES = {
  en: ["the", "a", "an", "to"],
  de: ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines"],
  fr: ["le", "la", "les", "un", "une", "des", "du", "de la", "de l'", "l'"],
  es: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l'", "un'"],
  pt: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
  ca: ["el", "la", "els", "les", "un", "una", "l'"],
  nl: ["de", "het", "een", "'t"],
  sv: ["en", "ett", "att"],
  da: ["en", "et", "at"],
  no: ["en", "ei", "et", "å"]
};
ARTICLES.nb = ARTICLES.nn = ARTICLES.no;
// "the cat" → { article: "the", word: "cat" }; an answer that is only an article stays itself
function splitArticle(text, lang) {
  const lower = text.normalize("NFC").toLowerCase().trim().replace(/’/g, "'");
  for (const article of [...(ARTICLES[lang] ?? [])].sort((a, b) => b.length - a.length)) {
    const glued = article.endsWith("'");
    if (lower.startsWith(glued ? article : `${article} `)) {
      const word = lower.slice(article.length).trim();
      if (word && !ARTICLES[lang].includes(word)) return { article, word }; // "the the" isn't "the"
    }
  }
  return { article: "", word: lower };
}

// A Cyrillic answer with a Latin letter that looks the same ("вiкно" typed on a keyboard without і):
// the letters are read as the Cyrillic ones they look like
const LOOKALIKES = { a: "а", c: "с", e: "е", i: "і", o: "о", p: "р", x: "х", y: "у" };
const cyrillicLookalikes = (answer) =>
  answer.replace(/\S+/g, (word) => (/\p{Script=Cyrillic}/u.test(word) ? word.replace(/[aceiopxy]/gi, (ch) => LOOKALIKES[ch.toLowerCase()]) : word)); // "Excel" next to "файл" stays Latin

// Chinese, Japanese and Korean: one character is a whole word, so nothing is folded or forgiven. A
// reading in brackets is an answer too: "猫 (ねこ)" takes 猫, ねこ or both.
const ONE_CHARACTER_WORDS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const exactly = (s) => plain(s.normalize("NFKC")).replace(/\s/g, ""); // full-width "ＡＢＣ" is "abc"; spaces don't count
const readings = (candidate) => {
  const bracket = candidate.normalize("NFKC").match(/^(.+?)\s*\((.+)\)\s*$/);
  if (!bracket) return [candidate];
  // a reading in kana or hangul counts on its own; a note in brackets ("猫 (animal)") doesn't
  return ONE_CHARACTER_WORDS.test(bracket[2]) ? [candidate, bracket[1], bracket[2]] : [candidate, bracket[1]];
};

// → "exact" | "accent" | "article" | "umlaut" | "typo" | "wrong"; accepts any one of the candidate answers. Missing or wrong
// diacritics ("zolw" for "żółw") are "accent": right, quietly (not everyone has the letters on their
// keyboard), with the missing letters marked in the verdict. `lang` is the answer's language, when the
// deck's languages are known: it adds that language's own spellings ("Baer" for "Bär"), and lets an
// article be left out ("cat" for "the cat": "accent"). Where the article carries the gender, one left
// out or swapped ("Hund", "die Hund" for "der Hund") is "article", and a German umlaut left plain
// ("Bar" for "Bär") is "umlaut": right, but not quite, so the card stays where it was. One more typo
// is forgiven on longer answers, but never in numbers: "123457" isn't "123456".
// `otherLang`: the other side's language (a card may be written the other way round); `native`: the
// language you use Dracosh in, where a left-out article is no slip
export const ALMOST = ["article", "umlaut", "article-umlaut"];
export function judge(answer, candidates, { lang = null, otherLang = null, native = null } = {}) {
  if (!answer.trim()) return "wrong";
  if (candidates.some((c) => plain(c) === plain(answer))) return "exact";
  // each candidate on its own: a card with "猫" and "cat" still forgives a typo in "cat"
  const words = candidates.filter((c) => ONE_CHARACTER_WORDS.test(c));
  if (words.some((c) => readings(c).some((one) => exactly(one) === exactly(answer)))) return "exact";
  candidates = candidates.filter((c) => !ONE_CHARACTER_WORDS.test(c));
  if (!candidates.length) return "wrong";
  const given = normalize(cyrillicLookalikes(answer));
  const targets = candidates.flatMap((c) => spellings(c, lang));
  const ways = candidates.map((c) => spelledAnyWay(answer, c, lang));
  if (ways.includes("spelled")) return "accent";
  if (ways.includes("plain")) return lang === "de" && native !== "de" ? "umlaut" : "accent";
  if (targets.includes(given)) return "accent";
  // the answer's language first, then the other side's, for a card written the other way round
  // (only when the answer's own language has articles too, and for an article of two letters or more:
  // Italian "i" in Polish "i tak" is no article)
  for (const one of [...new Set([lang, ARTICLES[lang] ? otherLang : null])].filter((l) => ARTICLES[l])) {
    const mine = splitArticle(answer, one);
    const other = one !== lang;
    const same = candidates
      .map((c) => splitArticle(c, one))
      .filter((c) => (!other || c.article.length >= 2) && spellings(c.word, one).includes(normalize(mine.word)));
    if (!same.length) continue;
    // Strict only in a language you're learning (your own you know), and only where the article
    // shows the gender: an article added, English "the", an infinitive's "to", an elided "l'" or a
    // plural "les" is as good as none
    const learning = GENDERED.has(one) && one !== native;
    const genderless = (c) => !learning || !c.article || c.article === mine.article || NO_GENDER.has(c.article) || NO_GENDER.has(mine.article) || Boolean(NO_GENDER_SHOWN[one]?.has(c.article));
    const fine = same.filter(genderless);
    // a German word still needs its umlauts after an added article ("die Bar" for "Bär")
    const plainUmlaut = (list) => one === "de" && learning && list.every((c) => spelledAnyWay(mine.word, c.word, one) === "plain");
    if (fine.length) return plainUmlaut(fine) ? "umlaut" : "accent";
    return plainUmlaut(same) ? "article-umlaut" : "article";
  }
  // "email" for "e-mail", "icecream" for "ice cream": right, but shown with the spelling
  const compact = (s) => s.replace(/\s/g, ""); // hyphens between letters are spaces by now
  if (targets.some((t) => compact(t) === compact(given))) return "typo";
  const numbers = /\d/.test(given);
  const close = targets.some((t) => t.length >= TYPO_MIN_LENGTH && !numbers && !/\d/.test(t) && editDistance(given, t) <= 1);
  return close ? "typo" : "wrong";
}
