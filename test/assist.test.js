import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
const { listPrompt, readListLine, readSuggestion, suggestCards, suggestionPrompt } = await import("../src/assist.js");
const { createServer } = await import("node:http");

// a model that streams `lines` (OpenAI-style events), a piece at a time; → its url and how far it got
async function streaming(lines, t) {
  const state = { written: 0, closed: false };
  const server = createServer(async (req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.on("close", () => (state.closed = true));
    for (const line of lines) {
      if (state.closed) break;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: line + "\n" } }] })}\n\n`);
      state.written++;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => (server.closeAllConnections(), server.close()));
  return { ai: { provider: "ollama", model: "m", url: `http://127.0.0.1:${server.address().port}/v1` }, state, close: () => (server.closeAllConnections(), server.close()) };
}

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

test("a list's lines become cards; numbering, bullets and bold go, chatter is skipped", () => {
  assert.deepEqual(readListLine("1. **der Löffel = the spoon; spoon // Ich brauche einen Löffel.**"), { front: "der Löffel", back: ["the spoon", "spoon"], example: "Ich brauche einen Löffel." });
  assert.deepEqual(readListLine("- fork = widelec"), { front: "fork", back: ["widelec"], example: "" });
  assert.equal(readListLine("Here are 10 kitchen words:"), null);
  assert.equal(readListLine("```"), null);
  assert.equal(readListLine("spoon ="), null);
  assert.equal(readListLine("Ella {{come}} pan. = she eats"), null, "a list is words, not gaps");
});

test("the list prompt carries the request, the deck's style and the fronts not to repeat", () => {
  const cards = [{ front: "kot", back: ["cat"], example: "" }, { front: "pies", back: ["dog"], example: "" }];
  const { system, prompt } = listPrompt({ request: "20 words for the kitchen", languages: { front: "pl", back: "en" }, cards });
  assert.match(system, /front = main answer; other accepted answer \/\/ one short example sentence/);
  assert.match(system, /never more than 50/);
  assert.match(system, /Fronts are in Polish, backs in English/);
  assert.match(prompt, /Don't repeat these fronts: kot, pies/);
  assert.ok(prompt.endsWith("Request: 20 words for the kitchen"));
});

test("thoughts opened in the prompt (only </think> comes back) never become cards", async (t) => {
  assert.deepEqual(readSuggestion('Okay, {"back": ["no"]}\n</think>\n{"back": ["dog"]}'), { back: ["dog"], example: "" });
  const model = await streaming(["Okay, the user wants kitchen words.", "Maybe fork = widelec first.", "</think>", "spoon = łyżka"], t);
  const heard = [];
  await suggestCards(model.ai, { request: "kitchen", onCard: (card) => heard.push(card.front) });
  assert.deepEqual(heard, ["spoon"]);
});

test("a preamble ending in a colon doesn't hold the list back", async (t) => {
  const model = await streaming(["Here are some kitchen words:", "spoon = łyżka", "fork = widelec"], t);
  const heard = [];
  await suggestCards(model.ai, { request: "kitchen", onCard: (card) => heard.push(card.front) });
  assert.deepEqual(heard, ["spoon", "fork"]);
});

test("a list stops being read at 50 cards", async (t) => {
  const model = await streaming(Array.from({ length: 200 }, (_, i) => `w${i} = a${i}`), t);
  let count = 0;
  assert.equal(await suggestCards(model.ai, { request: "many", onCard: () => count++ }), 50);
  assert.equal(count, 50);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(model.state.written < 200, `the stream was cut short (${model.state.written} lines written)`);
});
