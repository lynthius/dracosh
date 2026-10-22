import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

process.env.FORCE_COLOR = "1"; // colors on, as in a terminal, before Ink loads
const { default: React } = await import("react");
const { Box, render } = await import("ink");
const { Text, theme } = await import("../src/ui/kit.js");

// renders a component once, on a fake 80-column terminal, and returns its lines without colors
async function frame(element, { stdin } = {}) {
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 20, isTTY: true });
  let output = "";
  stdout.on("data", (chunk) => String(chunk).replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "").trim() && (output = String(chunk))); // the last frame with anything in it
  const app = render(element, { stdout, ...(stdin && { stdin }), debug: true, patchConsole: false });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const shown = output; // before unmounting, which writes a last cursor code
  app.unmount();
  return shown.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "").split("\n");
}

test("a wrapped line never starts with the space left over from the line above", async () => {
  // "aaa" fills the 3 columns exactly, which is when Ink pushes the space to the next line
  const plain = await frame(React.createElement(Box, { width: 3 }, React.createElement(Text, null, "aaa bbb ccc")));
  assert.deepEqual(plain.filter(Boolean), ["aaa", "bbb", "ccc"]);

  // the same with colored pieces inside: only the outermost Text wraps
  const nested = React.createElement(Text, null, "Press ", React.createElement(Text, { color: theme.accent }, "Enter"), " now for the next card");
  const lines = await frame(React.createElement(Box, { width: 9 }, nested));
  assert.ok(lines.filter(Boolean).every((line) => !line.startsWith(" ")), lines.join("|"));
});

test("a space that is drawn (the answer line's cursor) stays at the start of a wrapped line", async () => {
  const cursor = React.createElement(Text, { inverse: true }, " ");
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 20, isTTY: true });
  let output = "";
  stdout.on("data", (chunk) => (output = String(chunk)));
  const app = render(React.createElement(Box, { width: 3 }, React.createElement(Text, null, "abc", cursor)), { stdout, debug: true, patchConsole: false });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const shown = output;
  app.unmount();
  assert.match(shown, /\x1b\[7m \x1b\[27m/);
});

test("text with line breaks of its own keeps its indentation", async () => {
  const lines = await frame(React.createElement(Text, null, "one\n  two"));
  assert.ok(lines.includes("  two"), lines.join("|"));
});

test("the session summary renders, its today row whole", async () => {
  const { Summary } = await import("../src/ui/Summary.js");
  const stats = { streak: { days: 5, atRisk: false }, today: { correct: 20, goalMet: true }, goal: 20, companion: { index: 2, element: null } };
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} }); // it waits for a key
  const lines = await frame(React.createElement(Summary, { stats, totals: { asked: 6, correct: 4 }, bestCombo: 3, onDone: () => {} }), { stdin });
  assert.ok(lines.some((line) => line.includes("20/20")), JSON.stringify(lines));
});

test("a dragged-in file's path is read as the terminal pasted it", async () => {
  const { cleanPath } = await import("../src/ui/Import.js");
  const { homedir } = await import("node:os");
  assert.equal(cleanPath("/tmp/My\\ Spanish.csv "), "/tmp/My Spanish.csv", "spaces escaped");
  assert.equal(cleanPath("'/tmp/My Spanish.csv'"), "/tmp/My Spanish.csv", "in quotes");
  assert.equal(cleanPath("file:///tmp/My%20Spanish.csv"), "/tmp/My Spanish.csv");
  assert.equal(cleanPath("~/decks/a.apkg"), `${homedir()}/decks/a.apkg`);
  assert.equal(cleanPath("   "), "");
});

test("Tab in a card line goes to its next part, starting the part that isn't there yet", async () => {
  const { nextPart } = await import("../src/ui/AnswerInput.js");
  assert.deepEqual(nextPart("kot", 3), { value: "kot = ", cursor: 6 });
  assert.deepEqual(nextPart("kot = cat", 9), { value: "kot = cat // ", cursor: 13 });
  assert.deepEqual(nextPart("kot = cat", 1), { value: "kot = cat", cursor: 6 }, "from the front to the back");
  assert.deepEqual(nextPart("kot = cat // Mój kot", 7), { value: "kot = cat // Mój kot", cursor: 13 });
  assert.deepEqual(nextPart("kot = cat // Mój kot", 15), { value: "kot = cat // Mój kot", cursor: 0 }, "and round to the front");
});

test("/add opens on the deck list, or straight in a deck when one is given", async () => {
  const { AddCard } = await import("../src/ui/AddCard.js");
  const stdin = () => Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const actions = { ownDecks: async () => [{ name: "Spanish", cards: 3, directions: "forward" }], languagesOf: async () => ({ front: "es", back: "en", guessed: false }), existingCard: async () => null };
  const list = await frame(React.createElement(AddCard, { current: "Spanish", actions, onDone: () => {} }), { stdin: stdin() });
  assert.ok(list.some((line) => line.includes("+ New deck")), list.join("\n"));
  const into = await frame(React.createElement(AddCard, { current: "Spanish", actions, onDone: () => {}, into: "Spanish" }), { stdin: stdin() });
  assert.ok(into.some((line) => line.includes("Add a card · Spanish")), into.join("\n"));
});
