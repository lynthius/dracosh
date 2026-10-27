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
const { Cards } = await import("../src/ui/Cards.js");
setLanguage("en");

// a local model whose verdict is `verdict`, after `delay` ms
let server;
let url;
let verdict = '{"ok": true}';
let delay = 0;
let asked = 0;
before(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      asked++;
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: verdict } }] }));
      }, delay);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => (server.closeAllConnections(), server.close()));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (text) => text.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "");

// /cards on a deck with one card written by AI; → { type, screen, confirmed, updated, close }
async function openCards() {
  const confirmed = [];
  const updated = [];
  const cards = [{ id: "1", front: "kot", back: ["cat"], example: "", cloze: false, ai: true }];
  const actions = {
    cardsIn: async () => cards,
    ownDecks: async () => [{ name: "Polish", cards: 1 }],
    languagesOf: async () => ({ front: "pl", back: "en" }),
    confirmCardIn: async (deck, id) => (confirmed.push(id), (cards[0].ai = false)),
    updateCardIn: async (deck, id, fields) => (updated.push(fields), { card: { id, ...fields }, staleKeys: [] })
  };
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 30, isTTY: true });
  let output = "";
  stdout.on("data", (chunk) => plain(String(chunk)).trim() && (output = String(chunk)));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {}, setEncoding() {} });
  const props = { deck: "Polish", actions, ai: { provider: "ollama", model: "m", url }, onDeleted: async () => ({}), onRestored: async () => {}, onEdited: async () => {}, onAdd: () => {}, onClose: () => {} };
  const app = render(React.createElement(Cards, props), { stdout, stdin, debug: true, patchConsole: false });
  await wait(100);
  return { type: async (text, ms = 60) => (stdin.write(text), await wait(ms)), screen: () => plain(output), confirmed, updated, close: () => app.unmount() };
}

// the card's menu: ↓ to the card, Enter, then past the settle time of the choice
const openMenu = async (list) => (await list.type("\x1b[B"), await list.type("\r", 350));

test("an AI card found right by AI says so, and keeps its mark for you to check", async () => {
  verdict = '{"ok": true}';
  const list = await openCards();
  await openMenu(list);
  assert.match(list.screen(), /1\. Looks right\s+│\s+│\s+2\. Check with AI/);
  await list.type("\x1b[B");
  await list.type("\r", 300);
  assert.deepEqual(list.confirmed, []);
  assert.match(list.screen(), /Ollama sees nothing wrong: kot = cat/);
  assert.match(list.screen(), /✦ kot = cat/);
  list.close();
});

test("a fix suggested by AI shows its note and is used only when picked", async () => {
  verdict = '{"ok": false, "note": "kitty is accepted too", "front": "kot", "back": ["cat", "kitty"]}';
  const list = await openCards();
  await openMenu(list);
  await list.type("\x1b[B");
  await list.type("\r", 400);
  assert.match(list.screen(), /✦ kitty is accepted too/);
  assert.match(list.screen(), /kot = cat; kitty/);
  assert.deepEqual(list.updated, []);
  await list.type("\r", 150);
  assert.deepEqual(list.updated, [{ front: "kot", back: ["cat", "kitty"], example: "" }]);
  assert.match(list.screen(), /"kot" fixed\./);
  list.close();
});

test("Esc while AI checks goes back to the menu, and its late answer changes nothing", async () => {
  verdict = '{"ok": true}';
  delay = 300;
  const list = await openCards();
  await openMenu(list);
  await list.type("\x1b[B");
  await list.type("\r", 100);
  assert.match(list.screen(), /Ollama is checking the card…/);
  await list.type("\x1b", 500);
  assert.match(list.screen(), /❯ 2\. Check with AI/);
  assert.deepEqual(list.confirmed, []);
  delay = 0;
  list.close();
});

test("a double Enter asks once, and an answer after Esc and ← leaves /cards working", async () => {
  verdict = '{"ok": false, "note": "late", "front": "kot", "back": ["cat", "kitty"]}';
  delay = 250;
  asked = 0;
  const list = await openCards();
  await openMenu(list);
  await list.type("\x1b[B");
  await list.type("\r", 0);
  await list.type("\r", 120);
  await list.type("\x1b", 60);
  await list.type("\x1b[D", 500);
  assert.equal(asked, 1);
  await list.type("kot");
  assert.match(list.screen(), /search: kot/, "keys still reach the list");
  assert.doesNotMatch(list.screen(), /late/);
  delay = 0;
  list.close();
});

test("a check that only says what's wrong shows it, with nothing to take", async () => {
  verdict = '{"ok": false, "note": "the example is odd"}';
  const list = await openCards();
  await openMenu(list);
  await list.type("\x1b[B");
  await list.type("\r", 400);
  assert.match(list.screen(), /✦ the example is odd/);
  assert.match(list.screen(), /1\. Keep it as is/);
  assert.doesNotMatch(list.screen(), /Use the fix/);
  list.close();
});
