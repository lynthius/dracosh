import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS, commandsFor, matchCommands } from "../src/commands.js";
import { directionsFor, formatInterval, normalizeSettings } from "../src/settings.js";

test("'/' lists every command and a prefix narrows the list", () => {
  assert.equal(matchCommands("/").length, COMMANDS.length);
  assert.deepEqual(matchCommands("/s").map((c) => c.name), ["/settings", "/stats", "/snooze", "/skip"]);
  assert.deepEqual(matchCommands("/?").map((c) => c.name), ["/help"]); // alias
  assert.deepEqual(matchCommands("/snooze 30m").map((c) => c.name), ["/snooze"]); // arguments don't break matching
  assert.deepEqual(matchCommands("/SK").map((c) => c.name), ["/skip"]);
  assert.deepEqual(matchCommands("/nope"), []);
});

test("the menu only offers commands that make sense right now", () => {
  const names = (opts) => commandsFor(opts).map((c) => c.name);
  const common = ["/settings", "/stats", "/badges", "/companion", "/tip", "/missed", "/snooze", "/vacation"];
  assert.deepEqual(names({ phase: "asking" }), ["/hint", ...common, "/skip", "/help", "/quit"]);
  assert.deepEqual(names({ phase: "waiting" }), [...common, "/help", "/quit"]);
  assert.deepEqual(names({ phase: "waiting", canOverrule: true }), ["/correct", ...common, "/help", "/quit"]);
});

test("normalizeSettings falls back to defaults for invalid values", () => {
  const settings = normalizeSettings({ everyMs: "soon", sound: "yes", volume: 7, dailyGoal: 0, directions: "sideways" });
  assert.deepEqual(settings, { everyMs: 600_000, sound: true, volume: 0.5, dailyGoal: 20, directions: "both", tips: "always", quiet: null, skipWeekends: true });
  assert.equal(normalizeSettings({ everyMs: 300_000, sound: false, volume: 0.2, dailyGoal: 20, directions: "pl-en" }).dailyGoal, 20);
});

test("tips setting: old booleans are migrated, unknown values fall back", () => {
  assert.equal(normalizeSettings({ tips: true }).tips, "always");
  assert.equal(normalizeSettings({ tips: false }).tips, "off");
  assert.equal(normalizeSettings({ tips: "sometimes" }).tips, "sometimes");
  assert.equal(normalizeSettings({ tips: "often" }).tips, "always");
});

test("quiet hours are validated", () => {
  assert.deepEqual(normalizeSettings({ quiet: { from: 22, to: 8 } }).quiet, { from: 22, to: 8 });
  assert.equal(normalizeSettings({ quiet: { from: 25, to: 8 } }).quiet, null);
  assert.equal(normalizeSettings({ quiet: "night" }).quiet, null);
});

test("helpers", () => {
  assert.equal(formatInterval(300_000), "5 min");
  assert.equal(formatInterval(3_600_000), "1 h");
  assert.deepEqual(directionsFor("en-pl"), ["en-pl"]);
  assert.deepEqual(directionsFor("both"), ["en-pl", "pl-en"]);
});
