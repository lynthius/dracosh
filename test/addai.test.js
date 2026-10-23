import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
process.env.FORCE_COLOR = "0";
const { default: React } = await import("react");
const { render } = await import("ink");
const { setLanguage } = await import("../src/i18n.js");
const { AddCard } = await import("../src/ui/AddCard.js");
setLanguage("en");

// a local model that suggests "dog" for anything, after `delay` ms
let server;
let url;
let requests = [];
let delay = 0;
let listLines = null; // what the next list streams (null: the usual three cards)
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const asked = JSON.parse(body);
      requests.push(asked);
      if (asked.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const lines = listLines ?? ["<think>hmm</think>", "1. spoon = łyżka // Podaj łyżkę.", "kot = cat", "fork = widelec", "That's all!"];
        const event = (line) => `data: ${JSON.stringify({ choices: [{ delta: { content: line + "\n" } }] })}\n\n`;
        if (!delay) return res.end(lines.map(event).join("") + "data: [DONE]\n\n");
        let i = 0;
        const next = () => (i < lines.length ? (res.write(event(lines[i++])), setTimeout(next, delay)) : res.end("data: [DONE]\n\n"));
        return setTimeout(next, delay);
      }
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"back": ["dog"], "example": "Mój pies śpi."}' } }] }));
      }, delay);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (text) => text.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "");

// /add on one deck, with the library's actions faked; → { type, screen, saved, close }
async function openAdd() {
  const saved = [];
  const actions = {
    ownDecks: async () => [{ name: "Polish", cards: 1, directions: "forward" }],
    languagesOf: async () => ({ front: "pl", back: "en", learning: { lang: "pl", sure: true } }),
    cardsIn: async () => [{ id: "1", front: "kot", back: ["cat"], example: "", cloze: false }],
    existingCard: async () => null,
    addCardTo: async (deck, fields) => (saved.push(fields), { card: { id: String(saved.length + 1), ...fields } }),
    addCardsTo: async (deck, list) => ({ added: list.map((fields) => (saved.push(fields), { id: String(saved.length + 1), ...fields })) })
  };
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 30, isTTY: true });
  let output = "";
  stdout.on("data", (chunk) => plain(String(chunk)).trim() && (output = String(chunk)));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {}, setEncoding() {} });
  const app = render(React.createElement(AddCard, { current: "Polish", into: "Polish", actions, ai: { provider: "ollama", model: "m", url }, onDone: () => {} }), { stdout, stdin, debug: true, patchConsole: false });
  await wait(100);
  return {
    type: async (text, ms = 60) => (stdin.write(text), await wait(ms)),
    screen: () => plain(output),
    saved,
    close: () => app.unmount()
  };
}

test("after the front and ' = ', the back shows dimmed; Tab takes it, then the example", async () => {
  requests = [];
  const add = await openAdd();
  await add.type("pies = ", 700);
  assert.match(add.screen(), /pies = dog\s/);
  assert.doesNotMatch(add.screen(), /Mój pies/, "the example waits for its turn");
  assert.match(add.screen(), /✦ suggestion from Ollama/);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[1].content, /"front":"kot"/);
  assert.match(requests[0].messages[1].content, /Front: pies$/);
  await add.type("\t");
  assert.match(add.screen(), /pies = dog \/\/ Mój pies śpi\./);
  assert.match(add.screen(), /✦ example sentence from Ollama/);
  await add.type("\t");
  await add.type("\r", 100);
  assert.deepEqual(add.saved.map(({ front, back, example }) => ({ front, back, example })), [{ front: "pies", back: ["dog"], example: "Mój pies śpi." }]);
  add.close();
});

test("typing something else makes the suggestion go, and Enter saves only what's typed", async () => {
  const add = await openAdd();
  await add.type("pies = ", 700);
  await add.type("d");
  assert.match(add.screen(), /pies = dog/, "a typed letter that matches keeps it");
  await add.type("x");
  assert.doesNotMatch(add.screen(), /Mój pies/);
  await add.type("\r", 100);
  assert.deepEqual(add.saved[0].back, ["dx"]);
  add.close();
});

test("a front typed on before the pause asks once, for the last front only", async () => {
  requests = [];
  delay = 200;
  const add = await openAdd();
  await add.type("pi = ", 100);
  for (let i = 0; i < 3; i++) await add.type("\x7f", 20);
  await add.type("es = ", 900);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[1].content, /Front: pies$/);
  delay = 0;
  add.close();
});

test("?topic asks for a list: nothing kept until kept, a card already in the deck marked, Enter adds the kept", async () => {
  requests = [];
  const add = await openAdd();
  await add.type("?kitchen words");
  await add.type("\r", 400);
  assert.equal(requests[0].stream, true);
  assert.match(requests[0].messages[1].content, /Request: kitchen words$/);
  const screen = add.screen();
  assert.match(screen, /✦ Cards from AI · Polish/);
  assert.match(screen, /3 suggestions · 0 kept/);
  assert.match(screen, /○ spoon = łyżka/);
  assert.match(screen, /! kot = cat\s+already in the deck/);
  await add.type(" ");
  await add.type("\x1b[B");
  await add.type("\x1b[B");
  await add.type(" ");
  assert.match(add.screen(), /3 suggestions · 2 kept/);
  await add.type("\r", 150);
  assert.deepEqual(add.saved.map((card) => card.front), ["spoon", "fork"]);
  assert.equal(add.saved[0].example, "Podaj łyżkę.");
  add.close();
});

test("an AI list with nothing kept goes at once with Esc; a keeps all and a again none", async () => {
  const add = await openAdd();
  await add.type("?kitchen");
  await add.type("\r", 400);
  await add.type("a");
  assert.match(add.screen(), /2 kept/);
  await add.type("a");
  assert.match(add.screen(), /0 kept/);
  await add.type("\x1b", 120);
  assert.match(add.screen(), /New card/);
  assert.deepEqual(add.saved, []);
  add.close();
});

test("keys before the first card do nothing; Enter with nothing kept lets the list go on", async () => {
  delay = 150;
  const add = await openAdd();
  await add.type("?kitchen");
  await add.type("\r", 30);
  await add.type("\x1b[B", 10);
  await add.type("e", 10);
  await add.type(" ", 10);
  await add.type("\r", 10);
  assert.match(add.screen(), /Ollama is writing…/, "nothing to keep, fix or add before the first card");
  await wait(250);
  await add.type("\r", 30);
  assert.match(add.screen(), /Nothing kept yet/);
  await wait(900);
  assert.match(add.screen(), /❯ ○ spoon = łyżka/, "the cursor is on the first card");
  assert.match(add.screen(), /3 suggestions · 0 kept/, "the list was written to the end");
  delay = 0;
  add.close();
});

test("a list asked for while fixing the last card adds new cards, the fixed one stays", async () => {
  const add = await openAdd();
  await add.type("pear = gruszka");
  await add.type("\r", 150);
  await add.type("\x1b[A", 100);
  await add.type("\x15");
  await add.type("?kitchen");
  await add.type("\r", 400);
  await add.type(" ");
  await add.type("\r", 150);
  await add.type("apple = jabłko");
  await add.type("\r", 150);
  assert.deepEqual(add.saved.map((card) => card.front), ["pear", "spoon", "apple"]);
  add.close();
});

test("a list that came back empty gives the request back with Esc", async () => {
  listLines = ["Sorry, I can't help with that."];
  const add = await openAdd();
  await add.type("?kitchen");
  await add.type("\r", 400);
  assert.match(add.screen(), /No cards came back/);
  await add.type("\x1b", 150);
  assert.match(add.screen(), /❯ \?kitchen/);
  listLines = null;
  add.close();
});
