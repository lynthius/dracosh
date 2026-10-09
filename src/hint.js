const isLetter = (ch) => /\p{L}/u.test(ch);

// The answer to hint at: the shortest of the accepted ones (the easiest to recall).
export const hintTarget = (expected) => [...expected].sort((a, b) => a.length - b.length)[0];

// "fine-tuned" at level 2 → "f i _ _ - _ _ _ _ _". Never reveals the last letter, so a hint is never the answer.
export function makeHint(answer, level) {
  const letters = [...answer].filter(isLetter).length;
  const reveal = Math.min(level, Math.max(letters - 1, 0));
  let shown = 0;
  return [...answer].map((ch) => (isLetter(ch) ? (shown++ < reveal ? ch : "_") : ch)).join(" ");
}
