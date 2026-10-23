import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_WORDS_LANGUAGES, firstWords, hasFirstWords } from "../src/firstwords.js";
import { ALMOST, judge } from "../src/judge.js";
import { frontKey } from "../src/judge.js";

const pairs = FIRST_WORDS_LANGUAGES.flatMap((home) => FIRST_WORDS_LANGUAGES.filter((learning) => learning !== home).map((learning) => [home, learning]));

test("first words exist for every pair of their languages, and only there", () => {
  assert.equal(pairs.length, 42);
  for (const [home, learning] of pairs) assert.ok(hasFirstWords(home, learning));
  assert.equal(hasFirstWords("pl", "pl"), false, "one language is no pair");
  assert.equal(hasFirstWords("pl", "ja"), false);
  assert.equal(hasFirstWords("ja", "en"), false);
});

test("every pair gets 30 whole cards, none of them twice, nothing to type starting with /", () => {
  for (const [home, learning] of pairs) {
    const cards = firstWords(home, learning);
    assert.equal(cards.length, 30, `${home} → ${learning}`);
    for (const card of cards) {
      assert.ok(typeof card.front === "string" && card.front.trim() === card.front && card.front, `${learning}: ${JSON.stringify(card)}`);
      assert.ok(card.back.length >= 1 && card.back.every((answer) => answer && answer.trim() === answer && !answer.startsWith("/")), JSON.stringify(card));
    }
    assert.equal(new Set(cards.map((card) => frontKey(card.front))).size, 30, `${learning}: a front twice`);
    assert.equal(new Set(cards.map((card) => frontKey(card.back[0]))).size, 30, `${home}: an answer twice`);
  }
});

test("asked both ways, each card takes its own words: the article may be left out, a wrong one is almost", () => {
  for (const [home, learning] of pairs) {
    for (const card of firstWords(home, learning)) {
      assert.equal(judge(card.back[0], card.back, { lang: home, otherLang: learning, learning }), "exact");
      assert.equal(judge(card.front, [card.front], { lang: learning, otherLang: home, learning }), "exact");
    }
  }
  const de = firstWords("pl", "de");
  const dog = de.find((card) => card.back[0] === "pies");
  assert.equal(dog.front, "der Hund");
  assert.ok(ALMOST.includes(judge("Hund", [dog.front], { lang: "de", otherLang: "pl", learning: "de" })), "the article is what a learner has to get right");
  assert.equal(judge("die Hund", [dog.front], { lang: "de", otherLang: "pl", learning: "de" }), "article");
  const fr = firstWords("de", "fr");
  assert.equal(judge("chien", fr.find((card) => card.front === "le chien").back, { lang: "de", otherLang: "fr", learning: "fr" }), "wrong", "an answer in the wrong language");
  assert.equal(judge("Hund", fr.find((card) => card.front === "le chien").back, { lang: "de", otherLang: "fr", learning: "fr" }), "accent", "your own language's article is never asked for");
  assert.equal(judge("oeuf", ["l'œuf"], { lang: "fr", otherLang: "de", learning: "fr" }), "accent", "œ typed as oe");
});
