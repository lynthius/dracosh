import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, judge, normalize } from "../src/judge.js";

test("normalize ignores case, diacritics, ł and punctuation", () => {
  assert.equal(normalize("  Żółć, ŁÓDŹ! "), "zolc lodz");
  assert.equal(normalize("Parkinson's  Law"), "parkinsons law");
});

test("judge accepts any one of several translations, without diacritics", () => {
  const targets = ["rozgrzeszyć", "uniewinnić", "uwolnić"];
  assert.equal(judge("UNIEWINNIC", targets), "exact");
  assert.equal(judge("rozgrzeszyc", targets), "exact");
  assert.equal(judge("zupełnie coś innego", targets), "wrong");
  assert.equal(judge("", targets), "wrong");
});

test("judge forgives one typo only on longer answers", () => {
  assert.equal(judge("optymalizcja", ["optymalizacja"]), "typo");
  assert.equal(judge("optymalziacja", ["optymalizacja"]), "typo"); // swapped neighbours
  assert.equal(judge("cause", ["pause"]), "wrong"); // short word: one edit is a different word
  assert.equal(judge("optymaliz", ["optymalizacja"]), "wrong");
});

test("editDistance", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("ab", "ba"), 1);
  assert.equal(editDistance("", "abc"), 3);
});
