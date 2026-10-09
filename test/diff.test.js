import test from "node:test";
import assert from "node:assert/strict";
import { diffChars } from "../src/diff.js";
import { closestCandidate } from "../src/judge.js";

const marks = (given, target) => diffChars(given, target).map((p) => (p.ok ? "=" : "x")).join("");

test("identical answers are all green", () => {
  assert.equal(marks("kot", "kot"), "===");
});

test("case and Polish diacritics don't count as mistakes", () => {
  assert.equal(marks("ZABA", "żaba"), "====");
  assert.equal(marks("lodz", "Łódź"), "====");
});

test("one wrong letter is marked, the rest stays green", () => {
  assert.equal(marks("kat", "kot"), "=x=");
});

test("a missing letter doesn't shift the rest to red", () => {
  assert.equal(marks("czrny", "czarny"), "=====");
});

test("an extra letter is red, the rest green", () => {
  assert.equal(marks("czaarny", "czarny"), "==x====".replace("x", "x")); // one of the doubled letters is extra
  const result = diffChars("czaarny", "czarny");
  assert.equal(result.filter((p) => !p.ok).length, 1);
});

test("keeps the original characters, including spaces", () => {
  const result = diffChars("do siego", "Do Siego");
  assert.equal(result.map((p) => p.ch).join(""), "do siego");
  assert.ok(result.every((p) => p.ok));
});

test("a completely different answer is mostly red", () => {
  const result = diffChars("pies", "kot");
  assert.ok(result.filter((p) => !p.ok).length >= 3);
});

test("closestCandidate picks the nearest of several translations", () => {
  assert.equal(closestCandidate("czrwony", ["niebieski", "czerwony"]), "czerwony");
  assert.equal(closestCandidate("ZABA", ["żaba", "ropucha"]), "żaba");
});
