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

test("an answer in German may spell ä, ö, ü out; Danish and Norwegian æ, ø, å; no other language", () => {
  assert.equal(judge("Baer", ["Bär"], { lang: "de" }), "accent");
  assert.equal(judge("schoen", ["schön"], { lang: "de" }), "accent");
  assert.equal(judge("Muenchen", ["München"], { lang: "de" }), "accent");
  assert.equal(judge("Bar", ["Bär"], { lang: "de" }), "accent", "a missing accent still counts");
  assert.equal(judge("aeble", ["æble"], { lang: "da" }), "accent");
  assert.equal(judge("paa", ["på"], { lang: "no" }), "accent");
  assert.equal(judge("Baer", ["Bär"]), "wrong", "a deck's language unknown: no German spellings");
  assert.equal(judge("paeivae", ["päivä"], { lang: "fi" }), "wrong", "in Finnish ae isn't ä");
});

test("Chinese, Japanese and Korean answers are checked exactly: one character is a whole word", () => {
  assert.equal(judge("猫", ["猫"]), "exact");
  assert.equal(judge("犬", ["猫"]), "wrong");
  assert.equal(judge("ありがとう", ["ありがとう"]), "exact");
  assert.equal(judge("ありがと", ["ありがとう"]), "wrong", "no typo forgiven, however long");
  assert.equal(judge("我 爱 你", ["我爱你"]), "exact", "spaces don't count");
  assert.equal(judge("ＡＢＣ", ["ABC", "字"]), "exact", "full-width letters are the same letters");
  assert.equal(judge("고양이", ["고양이"]), "exact");
  assert.equal(judge("고양", ["고양이"]), "wrong");
});

test("articles don't decide an answer in that language: left out or added it counts, a different one is close", () => {
  assert.equal(judge("cat", ["the cat"], { lang: "en" }), "accent");
  assert.equal(judge("the cat", ["cat"], { lang: "en" }), "accent");
  assert.equal(judge("go", ["to go"], { lang: "en" }), "accent");
  assert.equal(judge("a cat", ["the cat"], { lang: "en" }), "accent", "a/the: either is fine");
  assert.equal(judge("Hund", ["der Hund"], { lang: "de" }), "accent");
  assert.equal(judge("die Hund", ["der Hund"], { lang: "de" }), "typo", "the wrong gender shows");
  assert.equal(judge("Baer", ["der Bär"], { lang: "de" }), "accent", "with a spelled-out umlaut too");
  assert.equal(judge("eau", ["l'eau"], { lang: "fr" }), "accent");
  assert.equal(judge("l’eau", ["eau"], { lang: "fr" }), "accent");
  assert.equal(judge("la maison", ["la maison"], { lang: "fr" }), "exact");
  assert.equal(judge("gato", ["el gato"], { lang: "es" }), "accent");
  assert.equal(judge("la gato", ["el gato"], { lang: "es" }), "typo");
  assert.equal(judge("huis", ["het huis"], { lang: "nl" }), "accent");
  assert.equal(judge("cat", ["the cat"]), "wrong", "a deck's language unknown: articles count");
  assert.equal(judge("the", ["the"], { lang: "en" }), "exact", "an answer that is only an article stays itself");
  assert.equal(judge("dog", ["the cat"], { lang: "en" }), "wrong");
  assert.equal(judge("die Katze", ["the cat"], { lang: "en" }), "wrong", "another language's articles aren't stripped");
});
