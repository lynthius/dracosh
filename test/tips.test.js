import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTipDeck, loadUserTips, shouldShowTip } from "../src/tips.js";

const bundled = JSON.parse(readFileSync(new URL("../data/tips.json", import.meta.url), "utf8"));

test("the bundled tips are well-formed and short enough for the wait screen", () => {
  assert.ok(bundled.length >= 250);
  assert.equal(new Set(bundled.map((t) => t.id)).size, bundled.length);
  for (const tip of bundled) {
    assert.ok(tip.cat && tip.text, tip.id);
    assert.ok(tip.text.length <= 200, `${tip.id} is ${tip.text.length} chars`);
  }
});

test("every tip is shown once before any repeats, and progress is kept in state", () => {
  const tips = [1, 2, 3].map((n) => ({ id: String(n), cat: "x", text: "t" }));
  const state = {};
  const deck = createTipDeck({ state, tips });
  const first = [deck.next().id, deck.next().id, deck.next().id];
  assert.deepEqual([...first].sort(), ["1", "2", "3"]);
  assert.equal(state.tips.seen.length, 3);

  // a new deck over the same state continues where the last one stopped; after a full cycle it starts over
  const again = createTipDeck({ state, tips }).next();
  assert.ok(["1", "2", "3"].includes(again.id));
  assert.equal(state.tips.seen.length, 1);
});

test("shouldShowTip honours always / sometimes / off", () => {
  assert.equal(shouldShowTip("always", () => 0.99), true);
  assert.equal(shouldShowTip("off", () => 0), false);
  assert.equal(shouldShowTip("sometimes", () => 0.1), true);
  assert.equal(shouldShowTip("sometimes", () => 0.9), false);
});

test("your own tips file is merged in, and a broken one is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "tips-"));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify([{ cat: "Mine", text: "  Use it.  " }, { text: "No category" }, { cat: "x" }, "junk"]));
  const tips = loadUserTips(good);
  assert.deepEqual(tips.map((t) => [t.cat, t.text]), [["Mine", "Use it."], ["My tips", "No category"]]);
  assert.ok(tips.every((t) => t.id.startsWith("u-")));

  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.deepEqual(loadUserTips(bad), []);
  assert.deepEqual(loadUserTips(join(dir, "missing.json")), []);
});
