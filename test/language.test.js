import assert from "node:assert/strict";
import { test } from "node:test";
import { deckLanguages, guessLanguage, languageName, UNKNOWN } from "../src/language.js";

test("a deck's cards tell their language: letters, common words, spellings", () => {
  assert.equal(guessLanguage(["kot", "pies", "jabłko", "żółw", "dziękuję", "szkoła"]), "pl");
  assert.equal(guessLanguage(["die Katze", "der Hund", "Schildkröte", "Straße"]), "de");
  assert.equal(guessLanguage(["el gato", "el perro", "la manzana", "niño"]), "es");
  assert.equal(guessLanguage(["le chat", "le chien", "la pomme", "l’école", "garçon"]), "fr");
  assert.equal(guessLanguage(["il gatto", "il cane", "la mela", "grazie", "città"]), "it");
  assert.equal(guessLanguage(["o gato", "o cão", "maçã", "não"]), "pt");
  assert.equal(guessLanguage(["de kat", "de hond", "het huis", "dank je"]), "nl");
  assert.equal(guessLanguage(["the cat", "to go", "the weather", "a bird"]), "en");
  assert.equal(guessLanguage(["кіт", "собака", "яблуко", "їжак"]), "uk");
  assert.equal(guessLanguage(["кошка", "собака", "яблоко", "мыло"]), "ru");
});

test("scripts that name their language at once", () => {
  assert.equal(guessLanguage(["猫", "狗", "苹果"]), "zh");
  assert.equal(guessLanguage(["猫", "りんご", "ありがとう"]), "ja");
  assert.equal(guessLanguage(["고양이", "개"]), "ko");
  assert.equal(guessLanguage(["γάτα", "σκύλος"]), "el");
});

test("too little to tell stays unknown, instead of a wrong guess", () => {
  assert.equal(guessLanguage(["kot"]), null, "one plain word could be many languages");
  assert.equal(guessLanguage(["kot", "cat"]), null);
  assert.equal(guessLanguage(["kot", "pies", "dom", "las"]), null, "one shared word ('las') isn't enough");
  assert.equal(guessLanguage(["2 + 2", "3 * 3", "sqrt(16)"]), null);
  assert.equal(guessLanguage([]), null);
});

test("plain a-z on enough cards, with nothing pointing elsewhere, is English", () => {
  assert.equal(guessLanguage(["cat", "dog", "apple", "turtle", "flat"]), "en");
  assert.equal(guessLanguage(["cat", "dog", "apple"]), null, "a few words aren't enough");
});

test("languages you set win over the guess; a cloze card's hint isn't guessed from", () => {
  const cards = [
    { front: "kot", back: ["cat"] },
    { front: "jabłko", back: ["apple"] },
    { front: "Mam {{psa}}", back: ["I have a dog"], cloze: true }
  ];
  assert.deepEqual(deckLanguages({ languages: { front: "pl", back: "en" } }, cards), { front: "pl", back: "en", guessed: false });
  const guessed = deckLanguages({ languages: null }, cards);
  assert.equal(guessed.guessed, true);
  assert.equal(guessed.back, UNKNOWN);
});

test("language names come in the UI's language", () => {
  assert.equal(languageName("es", "en"), "Spanish");
  assert.equal(languageName("es", "pl"), "hiszpański");
  assert.equal(languageName(UNKNOWN, "en"), null);
});
