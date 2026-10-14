import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, judge, normalize } from "../src/judge.js";

test("normalize ignores case, diacritics, ł and punctuation", () => {
  assert.equal(normalize("  Żółć, ŁÓDŹ! "), "zolc lodz");
  assert.equal(normalize("Parkinson's  Law"), "parkinsons law");
});

test("judge accepts any one of several translations; missing diacritics count, quietly", () => {
  const targets = ["rozgrzeszyć", "uniewinnić", "uwolnić"];
  assert.equal(judge("UNIEWINNIĆ", targets), "exact");
  assert.equal(judge("UNIEWINNIC", targets), "accent");
  assert.equal(judge("rozgrzeszyc", targets), "accent");
  assert.equal(judge("zupełnie coś innego", targets), "wrong");
  assert.equal(judge("", targets), "wrong");
});

test("letters without an accent mark fold the way a keyboard without them spells them", () => {
  assert.equal(judge("strasse", ["straße"]), "accent");
  assert.equal(judge("STRASSE", ["Straße"]), "accent");
  assert.equal(judge("straße", ["strasse"]), "accent");
  assert.equal(judge("coeur", ["cœur"]), "accent");
  assert.equal(judge("encyclopaedia", ["encyclopædia"]), "accent");
  assert.equal(judge("so", ["sø"]), "accent");
  assert.equal(judge("fin", ["ﬁn"]), "accent");
});

test("й, ї and ў are letters of their own, not accented и, і, у", () => {
  assert.equal(judge("мии", ["мий"]), "wrong");
  assert.equal(judge("іжак", ["їжак"]), "wrong");
  assert.equal(judge("ежик", ["ёжик"]), "accent", "ё is е with an accent");
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
  assert.equal(judge("3,14", ["3.14"]), "exact", "a decimal comma");
  assert.equal(judge("hello,world", ["hello world"]), "exact");
  assert.equal(judge("cafe\u0301", ["café"]), "exact", "an accent typed as a separate mark");
  assert.equal(judge("email", ["e-mail"]), "typo", "with or without the hyphen: right, shown with the spelling");
  assert.equal(judge("10:30", ["1030"]), "wrong");
  assert.equal(judge("oprogramowanie2", ["oprogramowanie"]), "wrong", "no typo tolerance once a number is in it");
  assert.notEqual(normalize("🐱"), normalize("🐶"), "emoji cards aren't duplicates of each other");
});

test("editDistance", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("ab", "ba"), 1);
  assert.equal(editDistance("", "abc"), 3);
});
