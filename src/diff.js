// Character diff of your answer against the expected one, for the "you wrote" line after a miss.
// Comparison is as forgiving as the judge: case, Polish diacritics and ł are ignored per character.

const foldChar = (ch) =>
  ch
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// → [{ ch, ok }] for every character of `given`: ok = this character lines up with `target`.
// Alignment comes from a Levenshtein backtrace, so a single missing or extra letter doesn't
// mark the whole rest of the word wrong.
export function diffChars(given, target) {
  const a = [...given].map(foldChar);
  const b = [...target].map(foldChar);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  // walk back, preferring matches; deletions in `target` don't produce a character of `given`
  const marks = new Array(a.length).fill(false);
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      marks[i - 1] = a[i - 1] === b[j - 1];
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      marks[i - 1] = false; // extra character you typed
      i -= 1;
    } else {
      j -= 1; // character you missed: nothing of yours to mark
    }
  }
  return [...given].map((ch, k) => ({ ch, ok: marks[k] }));
}
