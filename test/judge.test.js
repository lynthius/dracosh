import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, judge, normalize } from "../src/judge.js";

test("normalize ignores case, diacritics, ł and punctuation", () => {
  assert.equal(normalize("  Żółć, ŁÓDŹ! "), "zolc lodz");
  assert.equal(normalize("Parkinson's  Law"), "parkinsons law");
});

test("judge accepts any one of several translations; missing diacritics count, shown as close", () => {
  const targets = ["rozgrzeszyć", "uniewinnić", "uwolnić"];
  assert.equal(judge("UNIEWINNIĆ", targets), "exact");
  assert.equal(judge("UNIEWINNIC", targets), "typo");
  assert.equal(judge("rozgrzeszyc", targets), "typo");
  assert.equal(judge("zupełnie coś innego", targets), "wrong");
  assert.equal(judge("", targets), "wrong");
});

test("judge forgives one typo only on longer answers", () => {
  assert.equal(judge("optymalizcja", ["optymalizacja"]), "typo");
  assert.equal(judge("optymalziacja", ["optymalizacja"]), "typo"); // swapped neighbours
  assert.equal(judge("cause", ["pause"]), "wrong"); // short word: one edit is a different word
  assert.equal(judge("optymaliz", ["optymalizacja"]), "wrong");
});

test("sentence punctuation doesn't matter, but symbols and numbers do", () => {
  assert.equal(judge("hello world", ["Hello, world!"]), "exact");
  assert.equal(judge("well known", ["well-known"]), "exact");
  assert.equal(judge("dont", ["don't"]), "exact");
  assert.equal(judge("31.4", ["3.14"]), "wrong");
  assert.equal(judge("5", ["-5"]), "wrong");
  assert.equal(judge("C", ["C#"]), "wrong");
  assert.equal(judge("12", ["1/2"]), "wrong");
  assert.equal(judge("123457", ["123456"]), "wrong", "no typo tolerance in numbers");
  assert.equal(judge("🐉", ["🐉"]), "exact");
  assert.equal(judge("🐱", ["🐶"]), "wrong");
  assert.equal(judge("?", ["?"]), "exact");
  assert.notEqual(normalize("🐱"), normalize("🐶"), "emoji cards aren't duplicates of each other");
});

test("editDistance", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("ab", "ba"), 1);
  assert.equal(editDistance("", "abc"), 3);
});
