import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS } from "../src/commands.js";
import { MAX_FREEZES, STAGES } from "../src/progress.js";
import { BOX_INTERVALS_DAYS, NEW_PER_DAY } from "../src/scheduler.js";
import { createTipDeck, shouldShowTip, TIPS } from "../src/tips.js";

test("the tips are well-formed and short enough for the wait screen", () => {
  assert.ok(TIPS.length >= 20);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
  for (const tip of TIPS) {
    assert.ok(tip.cat && tip.text, tip.id);
    assert.ok(tip.text.length <= 120, `${tip.id} is ${tip.text.length} chars`);
  }
});

test("the tips only name commands that exist and numbers the app really uses", () => {
  const names = [...COMMANDS.map((c) => c.name), "/correct"]; // "/sn" may stand for /snooze
  for (const tip of TIPS) {
    for (const command of tip.text.match(/(?<![\w~])\/[a-z]+/g) ?? []) assert.ok(names.some((name) => name.startsWith(command)), `${tip.id}: ${command}`);
  }
  const text = (id) => TIPS.find((t) => t.id === id).text;
  assert.match(text("cards-boxes"), new RegExp(`${BOX_INTERVALS_DAYS.slice(0, -1).join(", ")}, then ${BOX_INTERVALS_DAYS.at(-1)} days`));
  assert.match(text("dragon-forms"), new RegExp(`${STAGES.slice(1, -1).map((s) => s.from).join(", ")} and ${STAGES.at(-1).from} days`));
  assert.match(text("cards-new"), new RegExp(`${NEW_PER_DAY} new`));
  assert.equal(MAX_FREEZES, 2, "streak-freeze says you can keep two");
});

test("every tip is shown once before any repeats, and progress is kept in state", () => {
  const tips = [1, 2, 3].map((n) => ({ id: String(n), cat: "x", text: "t" }));
  const state = { tips: { seen: ["old-grammar-tip"] } };
  const deck = createTipDeck({ state, tips });
  const first = [deck.next().id, deck.next().id, deck.next().id];
  assert.deepEqual([...first].sort(), ["1", "2", "3"]);
  assert.deepEqual([...state.tips.seen].sort(), ["1", "2", "3"], "ids of removed tips are dropped");

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
