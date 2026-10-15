import assert from "node:assert/strict";
import { test } from "node:test";
import { blankGap, formatLine, gapsOf, parseBack, parseLine, plainFront } from "../src/cardline.js";

const card = (line, options) => {
  const { front, back, example, cloze, hasBack } = parseLine(line, options);
  return { front, back, example, cloze, hasBack };
};

test("one line is a card: front = back; more answers // example", () => {
  assert.deepEqual(card("kot = cat; kitty // Mój kot śpi."), { front: "kot", back: ["cat", "kitty"], example: "Mój kot śpi.", cloze: false, hasBack: true });
  assert.deepEqual(card("  pies =  dog  "), { front: "pies", back: ["dog"], example: "", cloze: false, hasBack: true });
});

test("only separators with spaces around them split, so formulas, decimals, sentences and links stay whole", () => {
  assert.deepEqual(card("E=mc² = Einstein").front, "E=mc²");
  assert.deepEqual(card("x==y = equal").front, "x==y");
  assert.deepEqual(card("półtora = 1,5").back, ["1,5"]);
  assert.deepEqual(card("Tak, chcę = Yes, I do").back, ["Yes, I do"], "commas belong to sentences");
  assert.deepEqual(card("docs = https://example.com/a//b").back, ["https://example.com/a//b"]);
  assert.deepEqual(card("a = b = c").back, ["b = c"], "the first ' = ' splits, the rest is the back");
});

test("a backslash keeps a separator as text", () => {
  assert.equal(card("a \\= b = c").front, "a = b");
  assert.deepEqual(card("x = one\\; two").back, ["one; two"]);
  assert.equal(card("x = y \\// z").back[0], "y // z");
  assert.deepEqual(card("I \\{{x}} = y"), { front: "I {{x}}", back: ["y"], example: "", cloze: false, hasBack: true });
});

test("without ' = ' the back comes in a second step; a cloze card needs none", () => {
  assert.deepEqual(card("kot"), { front: "kot", back: [], example: "", cloze: false, hasBack: false });
  assert.equal(card("kot =").hasBack, false, "a trailing ' =' is still just the front");
  assert.deepEqual(parseBack("cat; kitty // Mój kot śpi."), { back: ["cat", "kitty"], example: "Mój kot śpi." });
  assert.deepEqual(parseBack("// only an example"), { back: [], example: "only an example" });
  assert.equal(card("I {{look forward}} to it").cloze, true);
});

test("gaps: each one asked on its own, the others filled in", () => {
  const front = "I {{look forward}} to {{ it }}";
  assert.deepEqual(gapsOf(front), ["look forward", "it"]);
  assert.equal(blankGap(front, 0), "I ____ to it");
  assert.equal(blankGap(front, 1), "I look forward to ____");
  assert.equal(plainFront(front), "I look forward to it");
  assert.equal(card("{{}} = empty").cloze, false, "an empty gap isn't one");
});

test("a pasted export splits on tabs", () => {
  assert.deepEqual(card("kot\tcat; kitty", { separator: "\t" }).back, ["cat", "kitty"]);
});

test("a card turned back into a line reads the same again", () => {
  for (const line of ["kot = cat; kitty // Mój kot śpi.", "a \\= b = c", "x = one\\; two", "I \\{{x}} = y", "I {{look forward}} to it = Cieszę się", "kot =  // only an example", "x = y \\// z"]) {
    const once = parseLine(line);
    assert.deepEqual(parseLine(formatLine(once)), once, line);
  }
});

test("edge cases: a trailing ' =', an example right after ' =', escaped braces next to a gap, empty and nested gaps", () => {
  assert.deepEqual(card("kot ="), { front: "kot", back: [], example: "", cloze: false, hasBack: false });
  assert.deepEqual(card("kot = // Mój kot śpi."), { front: "kot", back: [], example: "Mój kot śpi.", cloze: false, hasBack: true });
  const escaped = parseLine("\\{{a}} {{b}} c");
  assert.deepEqual([escaped.front, gapsOf(escaped.front)], ["\\{{a}} {{b}} c", ["b"]], "the escaped braces stay text");
  assert.equal(blankGap(escaped.front, 0), "{{a}} ____ c");
  assert.equal(card("x {{ }} y = hint").cloze, false);
  assert.deepEqual(gapsOf("{{a {{b}} c}}"), ["b"]);
  assert.equal(card("a \\\\ b = c").front, "a \\ b", "a doubled backslash is one backslash");
});

test("any card turns into a line that reads back as the same card", () => {
  const atoms = ["a", "b", " ", "=", ";", "/", "//", "\\", "{{", "}}", "ł", " = ", " // ", "{{c}}", ","];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const piece = () => Array.from({ length: 1 + Math.floor(random() * 6) }, () => atoms[Math.floor(random() * atoms.length)]).join("").trim();
  for (let i = 0; i < 5000; i++) {
    const once = parseLine(`${piece()} = ${piece()}; ${piece()} // ${piece()}`);
    if (!once.front) continue;
    assert.deepEqual(parseLine(formatLine(once)), { ...once, hasBack: parseLine(formatLine(once)).hasBack }, formatLine(once));
  }
});

test("a cloze card: its example may follow the front, and its hint keeps its semicolons", () => {
  assert.deepEqual(parseLine("Ella {{come}} pan. // She eats bread."), { front: "Ella {{come}} pan.", back: [], example: "She eats bread.", cloze: true, hasBack: false });
  const hint = parseLine("I {{get on with}} my boss. = Dogaduję się; jest miły.");
  assert.deepEqual(hint.back, ["Dogaduję się; jest miły."]);
  assert.deepEqual(parseLine(formatLine(hint)), hint);
  assert.equal(formatLine(parseLine("Ella {{come}} pan. // She eats bread.")), "Ella {{come}} pan. // She eats bread.");
});
