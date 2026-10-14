// Typos are forgiven only on longer answers: on short words one edit often makes a different word
const TYPO_MIN_LENGTH = 6;

// Sentence punctuation that never changes what an answer means ("Hello, world!" = "hello world").
// Everything else stays: "3.14" isn't "31.4", "-5" isn't "5", "C#" isn't "C", and 🐉 is an answer too.
const LOOSE = /[;!?¡¿"“”„«»()[\]'’`]/g;

// lowercase, loose punctuation dropped, a trailing full stop dropped, hyphens between letters as spaces.
// Commas and colons count between digits only: "3,14" is "3.14" (a decimal comma), "10:30" stays.
function plain(s) {
  const text = s
    .normalize("NFC") // "café" typed or pasted with a separate accent mark is the same word
    .toLowerCase()
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

// The candidate the answer came closest to (fewest edits after normalizing): what a miss is diffed against
export function closestCandidate(answer, candidates) {
  const given = normalize(answer);
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
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
const SPELLED_OUT = {
  de: { ä: "ae", ö: "oe", ü: "ue" },
  da: { æ: "ae", ø: "oe", å: "aa" },
  no: { æ: "ae", ø: "oe", å: "aa" }
};
function spellings(candidate, lang) {
  const forms = [normalize(candidate)];
  const letters = SPELLED_OUT[lang];
  if (letters) forms.push(normalize(plain(candidate).replace(/[äöüæøå]/g, (ch) => letters[ch] ?? ch)));
  return forms;
}

// Chinese, Japanese and Korean: one character is a whole word, so nothing is folded or forgiven
const ONE_CHARACTER_WORDS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const exactly = (s) => plain(s).normalize("NFKC").replace(/\s/g, ""); // full-width "ＡＢＣ" is "abc"; spaces don't count

// → "exact" | "accent" | "typo" | "wrong"; accepts any one of the candidate answers. Missing or wrong
// diacritics ("zolw" for "żółw") are "accent": right, quietly (not everyone has the letters on their
// keyboard), with the missing letters marked in the verdict. `lang` is the answer's language, when the
// deck's languages are known: it adds that language's own spellings ("Baer" for "Bär"). One more typo
// is forgiven on longer answers, but never in numbers: "123457" isn't "123456".
export function judge(answer, candidates, { lang = null } = {}) {
  if (!answer.trim()) return "wrong";
  if (candidates.some((c) => plain(c) === plain(answer))) return "exact";
  if (candidates.some((c) => ONE_CHARACTER_WORDS.test(c))) return candidates.some((c) => exactly(c) === exactly(answer)) ? "exact" : "wrong";
  const given = normalize(answer);
  const targets = candidates.flatMap((c) => spellings(c, lang));
  if (targets.includes(given)) return "accent";
  // "email" for "e-mail", "icecream" for "ice cream": right, but shown with the spelling
  const compact = (s) => s.replace(/\s/g, ""); // hyphens between letters are spaces by now
  if (targets.some((t) => compact(t) === compact(given))) return "typo";
  const numbers = /\d/.test(given);
  const close = targets.some((t) => t.length >= TYPO_MIN_LENGTH && !numbers && !/\d/.test(t) && editDistance(given, t) <= 1);
  return close ? "typo" : "wrong";
}
