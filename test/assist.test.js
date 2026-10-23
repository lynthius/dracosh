import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { readSuggestion, suggestionPrompt } = await import("../src/assist.js");

test("a suggestion is read from JSON, even wrapped in prose or a code fence", () => {
  assert.deepEqual(readSuggestion('{"back": ["dog", "hound"], "example": "Mój pies śpi."}'), { back: ["dog", "hound"], example: "Mój pies śpi." });
  assert.deepEqual(readSuggestion('Sure!\n```json\n{"back": "dog"}\n```'), { back: ["dog"], example: "" });
});

test("a reasoning model's thoughts are skipped", () => {
  assert.deepEqual(readSuggestion('<think>The user wants {"back": ["no"]}...</think>\n{"back": ["dog"]}'), { back: ["dog"], example: "" });
  assert.equal(readSuggestion("<think>still thinking when the tokens ran out"), null);
});

test("a model that answers with a card line instead is understood too", () => {
  assert.deepEqual(readSuggestion("dog; hound // Mój pies śpi.\nHope this helps"), { back: ["dog", "hound"], example: "Mój pies śpi." });
});

test("nothing usable is null; what's kept can't break the card line", () => {
  assert.equal(readSuggestion(""), null);
  assert.equal(readSuggestion('{"back": []}'), null);
  assert.equal(readSuggestion("{broken"), null);
  const odd = readSuggestion('{"back": ["a = b", "one; two", "x // y"], "example": "line\\nbreak"}');
  assert.deepEqual(odd, { back: ["a b", "one, two", "x y"], example: "line break" });
  assert.equal(readSuggestion(`{"back": ["${"a".repeat(500)}"]}`).back[0].length, 120);
  assert.equal(readSuggestion('{"back": ["1", "2", "3", "4"]}').back.length, 3);
});

test("the prompt names the deck's languages and shows only a few of its cards, and only them", () => {
  const cards = Array.from({ length: 9 }, (_, i) => ({ front: `w${i}`, back: [`a${i}`], example: i === 8 ? "Ex." : "" }));
  cards.push({ front: "Ella {{come}} pan.", back: [], cloze: true });
  const { system, prompt } = suggestionPrompt({ front: "pies", languages: { front: "pl", back: "en", learning: { lang: "pl" } }, cards });
  assert.match(system, /fronts are in Polish, its backs in English/);
  assert.match(system, /example sentence that uses the word in Polish\./);
  assert.match(system, /JSON only/);
  assert.equal((prompt.match(/"front"/g) ?? []).length, 5);
  assert.ok(prompt.includes('{"front":"w8","back":["a8"],"example":"Ex."}'));
  assert.ok(!prompt.includes("w3") && !prompt.includes("{{come}}"));
  assert.ok(prompt.endsWith("Front: pies"));
});

test("a new deck with nothing known still gets a prompt", () => {
  const { system, prompt } = suggestionPrompt({ front: "kot" });
  assert.match(system, /Follow the languages of the deck's cards/);
  assert.equal(prompt, "Front: kot");
});
