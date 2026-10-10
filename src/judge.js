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

// plain(), and diacritics folded too (ł doesn't decompose, so it is mapped by hand)
export function normalize(s) {
  return plain(s).replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

// → "exact" | "typo" | "wrong"; accepts any one of the candidate answers. Missing or wrong
// diacritics ("zolw" for "żółw") count, as "typo", so the right spelling is shown. One more typo is
// forgiven on longer answers, but never in numbers: "123457" isn't "123456".
export function judge(answer, candidates) {
  if (!answer.trim()) return "wrong";
  const given = normalize(answer);
  if (candidates.some((c) => plain(c) === plain(answer))) return "exact";
  const targets = candidates.map(normalize);
  if (targets.includes(given)) return "typo";
  // "email" for "e-mail", "icecream" for "ice cream": right, but shown with the spelling
  const compact = (s) => s.replace(/\s/g, ""); // hyphens between letters are spaces by now
  if (targets.some((t) => compact(t) === compact(given))) return "typo";
  const numbers = /\d/.test(given);
  const close = targets.some((t) => t.length >= TYPO_MIN_LENGTH && !numbers && !/\d/.test(t) && editDistance(given, t) <= 1);
  return close ? "typo" : "wrong";
}
