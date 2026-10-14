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
  assert.equal(judge("Bar", ["Bär"], { lang: "de" }), "umlaut", "a German umlaut left plain counts, as almost");
  assert.equal(judge("pa", ["på"], { lang: "no" }), "accent", "elsewhere a missing accent counts in full");
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
  assert.equal(judge("Hund", ["der Hund"], { lang: "de" }), "article", "where the article carries the gender: almost");
  assert.equal(judge("die Hund", ["der Hund"], { lang: "de" }), "article");
  assert.equal(judge("der Hund", ["Hund"], { lang: "de" }), "accent", "an article added is fine");
  assert.equal(judge("Baer", ["der Bär"], { lang: "de" }), "article", "with a spelled-out umlaut too");
  assert.equal(judge("eau", ["l'eau"], { lang: "fr" }), "article");
  assert.equal(judge("l’eau", ["eau"], { lang: "fr" }), "accent");
  assert.equal(judge("la maison", ["la maison"], { lang: "fr" }), "exact");
  assert.equal(judge("gato", ["el gato"], { lang: "es" }), "article");
  assert.equal(judge("la gato", ["el gato"], { lang: "es" }), "article");
  assert.equal(judge("huis", ["het huis"], { lang: "nl" }), "article");
  assert.equal(judge("cat", ["the cat"]), "wrong", "a deck's language unknown: articles count");
  assert.equal(judge("the", ["the"], { lang: "en" }), "exact", "an answer that is only an article stays itself");
  assert.equal(judge("dog", ["the cat"], { lang: "en" }), "wrong");
  assert.equal(judge("die Katze", ["the cat"], { lang: "en" }), "wrong", "another language's articles aren't stripped");
});

test("each candidate is judged its own way: a CJK one doesn't make the Latin ones strict", () => {
  assert.equal(judge("cafe", ["café", "猫"]), "accent");
  assert.equal(judge("doggi", ["doggie", "猫"]), "typo");
  assert.equal(judge("Baer", ["Bär", "熊"], { lang: "de" }), "accent");
  assert.equal(judge("犬", ["cat", "猫"]), "wrong");
});

test("CJK punctuation and full-width signs read like ours; a reading in brackets is an answer too", () => {
  assert.equal(judge("ありがとう！", ["ありがとう"]), "exact");
  assert.equal(judge("ありがとう。", ["ありがとう"]), "exact");
  assert.equal(judge("はい、そうです。", ["はい、そうです"]), "exact");
  assert.equal(judge("本当？", ["本当"]), "exact");
  assert.equal(judge("猫（ねこ）", ["猫 (ねこ)"]), "exact");
  assert.equal(judge("猫", ["猫 (ねこ)"]), "exact");
  assert.equal(judge("ねこ", ["猫 (ねこ)"]), "exact");
  assert.equal(judge("ｎｅｋｏ", ["neko"]), "exact", "full-width letters from a Japanese keyboard");
});

test("spelled-out letters may be mixed with kept or plain ones in one answer", () => {
  assert.equal(judge("Gruesse aus Köln", ["Grüße aus Köln"], { lang: "de" }), "accent");
  assert.equal(judge("Baer und Mädchen", ["Bär und Mädchen"], { lang: "de" }), "accent");
  assert.equal(judge("Baer und Madchen", ["Bär und Mädchen"], { lang: "de" }), "umlaut", "one umlaut left plain");
  assert.equal(judge("Baer", ["Bär"], { lang: "nb" }), "wrong", "Norwegian Bokmål has no ä");
  assert.equal(judge("paa", ["på"], { lang: "nb" }), "accent");
});

test("Ukrainian: both apostrophes, and Latin letters that look Cyrillic, are the same answer", () => {
  assert.equal(judge("сім'я", ["сімʼя"]), "exact");
  assert.equal(judge("сімʼя", ["сім'я"]), "exact");
  assert.equal(judge("вiкно", ["вікно"]), "accent", "a Latin i typed for і");
  assert.equal(judge("kot", ["кот"]), "wrong", "an answer all in Latin letters isn't read as Cyrillic");
});

test("edge cases from testing: mixed scripts, long å runs, doubled articles, notes in brackets", () => {
  assert.equal(judge("Excel файлл", ["Excel файл"]), "typo", "a Latin word next to a Cyrillic one stays Latin");
  const started = Date.now();
  assert.notEqual(judge(`${"a".repeat(79)}b`, ["å".repeat(40)], { lang: "no" }), "accent");
  assert.ok(Date.now() - started < 200, "a long run of å stays quick");
  assert.equal(judge("the the", ["the"], { lang: "en" }), "wrong", "a doubled article isn't the article");
  assert.equal(judge("the the", ["cat"], { lang: "en" }), "wrong");
  assert.equal(judge("animal", ["猫 (animal)"]), "wrong", "a note in brackets isn't an answer");
  assert.equal(judge("猫", ["猫 (animal)"]), "exact");
});
