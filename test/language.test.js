import assert from "node:assert/strict";
import { test } from "node:test";
import { deckLanguages, guessLanguage, languageInName, languageName, languagesInName, UNKNOWN } from "../src/language.js";

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
  assert.equal(guessLanguage(["кошка", "собака", "мыло", "это", "ёж"]), "ru");
  assert.equal(guessLanguage(["котка", "куче", "къща", "ябълка", "хлябът"]), "bg");
});

test("scripts that name their language at once", () => {
  assert.equal(guessLanguage(["狗", "苹果", "谢谢", "朋友"]), "zh");
  assert.equal(guessLanguage(["学校", "車", "犬", "仕事", "山"]), null, "kanji alone could be Japanese too");
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

test("a deck named after a language says which: in the UI's language, in English or in its own", () => {
  assert.equal(languageInName("Hiszpański", "pl"), "es");
  assert.equal(languageInName("Spanish verbs", "pl"), "es");
  assert.equal(languageInName("Español A1", "en"), "es");
  assert.equal(languageInName("Німецька", "uk"), "de");
  assert.equal(languageInName("Biology", "en"), null);
  assert.deepEqual(languagesInName("German-English", "pl"), ["de", "en"]);
});

test("a side the cards don't tell comes from the deck's name, or from your language when the cards show it", () => {
  const card = (front, back) => ({ front, back: [back] });
  assert.deepEqual(deckLanguages({ name: "Hiszpański" }, [card("żółw", "tortuga"), card("jabłko", "manzana")], "pl"), { front: "pl", back: "es", guessed: true }, "the name's language goes opposite a side known to be another");
  assert.deepEqual(deckLanguages({ name: "Polish to German" }, [card("pies", "Hund"), card("kot", "Katze")], "en"), { front: "pl", back: "de", guessed: true }, "two languages in the name, in that order");
  assert.deepEqual(deckLanguages({ name: "Polish to German" }, [card("pies", "der Hund"), card("dom", "das Haus")], "en"), { front: "pl", back: "de", guessed: true }, "one side known: the other name goes on the other");
  assert.deepEqual(deckLanguages({ name: "Words" }, [card("el gato", "kot"), card("el perro", "mój pies"), card("la casa", "dom")], "pl"), { front: "es", back: "pl", guessed: true }, "a Polish letter on the back: your language");
  assert.deepEqual(deckLanguages({ name: "Words" }, [card("el gato", "kot"), card("el perro", "pies")], "pl"), { front: "es", back: UNKNOWN, guessed: true }, "no sign of Polish yet: not assumed");
  assert.deepEqual(deckLanguages({ name: "Hiszpański" }, [card("gato", "kot")], "pl"), { front: UNKNOWN, back: UNKNOWN, guessed: true }, "which side is which can't be told yet");
  const biology = [card("mitochondria", "the powerhouse of the cell"), card("osmosis", "the movement of water through a membrane"), card("enzyme", "a protein that speeds up a reaction")];
  assert.equal(deckLanguages({ name: "Biology" }, biology, "pl").front === "pl", false, "a deck in one language isn't given yours");
  assert.deepEqual(deckLanguages({ name: "Polski" }, [card("kot", "zwierzę domowe")], "uk"), { front: UNKNOWN, back: "pl", guessed: true }, "Latin letters are never Ukrainian");
  assert.deepEqual(deckLanguages({ name: "Empty" }, [], "pl"), { front: UNKNOWN, back: UNKNOWN, guessed: true });
});

test("Cyrillic and other close languages: unknown rather than mixed up", () => {
  assert.equal(guessLanguage(["собака", "вода", "мама", "школа", "яблуко", "молоко"]), null, "plain Cyrillic isn't taken for Russian");
  assert.equal(guessLanguage(["дзякуй", "добры дзень", "ўсё добра", "і ты"]), "be");
  assert.equal(guessLanguage(["mačka", "kuća", "jabuka", "ići", "hvala lijepa"]), "hr", "ć alone isn't Polish");
  assert.equal(guessLanguage(["pas"]), null, "one shared word on one card says nothing");
  assert.equal(guessLanguage(["https://example.com"]), null);
  assert.equal(guessLanguage(["to go", "to eat", "to sleep", "to write", "to read"]), "en");
  assert.equal(guessLanguage(["to je pes"]), null, "Czech 'to' isn't English");
  assert.notEqual(guessLanguage(["to jest kot", "to dom", "to moja mama"]), "en");
  assert.equal(guessLanguage(["gato", "casa", "perro", "hola", "agua", "mesa"]), null, "plain words ending in vowels aren't English");
});
