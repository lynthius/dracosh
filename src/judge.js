// Typos are forgiven only on longer answers: on short words one edit often makes a different word
const TYPO_MIN_LENGTH = 6;

// lowercase, strip diacritics (ł doesn't decompose, so it is mapped by hand), drop punctuation
export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

// → "exact" | "typo" | "wrong"; accepts any one of the candidate answers
export function judge(answer, candidates) {
  const given = normalize(answer);
  if (!given) return "wrong";
  const targets = candidates.map(normalize).filter(Boolean);
  if (targets.includes(given)) return "exact";
  const close = targets.some((t) => t.length >= TYPO_MIN_LENGTH && editDistance(given, t) <= 1);
  return close ? "typo" : "wrong";
}
