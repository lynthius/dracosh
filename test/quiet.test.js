import assert from "node:assert/strict";
import { test } from "node:test";
import { hintTarget, makeHint } from "../src/hint.js";
import { formatQuiet, inQuietHours, parseSnooze, quietEnd } from "../src/quiet.js";

const at = (iso) => new Date(iso).getTime();

test("quiet hours that cross midnight", () => {
  const night = { from: 22, to: 8 };
  assert.equal(inQuietHours(at("2026-10-09T23:30:00"), night), true);
  assert.equal(inQuietHours(at("2026-10-09T03:00:00"), night), true);
  assert.equal(inQuietHours(at("2026-10-09T07:59:00"), night), true);
  assert.equal(inQuietHours(at("2026-10-09T08:00:00"), night), false);
  assert.equal(inQuietHours(at("2026-10-09T15:00:00"), night), false);
});

test("quiet hours within one day, and none at all", () => {
  assert.equal(inQuietHours(at("2026-10-09T13:00:00"), { from: 12, to: 14 }), true);
  assert.equal(inQuietHours(at("2026-10-09T14:00:00"), { from: 12, to: 14 }), false);
  assert.equal(inQuietHours(at("2026-10-09T03:00:00"), null), false);
  assert.equal(inQuietHours(at("2026-10-09T03:00:00"), { from: 8, to: 8 }), false);
});

test("quietEnd is the next time the quiet window closes", () => {
  const night = { from: 22, to: 8 };
  assert.equal(quietEnd(at("2026-10-09T23:30:00"), night), at("2026-10-10T08:00:00"));
  assert.equal(quietEnd(at("2026-10-09T03:00:00"), night), at("2026-10-09T08:00:00"));
});

test("parseSnooze understands minutes, hours, seconds and off", () => {
  assert.equal(parseSnooze(""), 3_600_000);
  assert.equal(parseSnooze("30"), 1_800_000);
  assert.equal(parseSnooze("30m"), 1_800_000);
  assert.equal(parseSnooze("2h"), 7_200_000);
  assert.equal(parseSnooze("90s"), 90_000);
  assert.equal(parseSnooze("OFF"), "off");
  assert.equal(parseSnooze("0"), "off");
  assert.equal(parseSnooze("soon"), null);
  assert.equal(formatQuiet({ from: 22, to: 8 }), "22:00–08:00");
  assert.equal(formatQuiet(null), "off");
});

test("hints reveal letters progressively but never the whole answer", () => {
  assert.equal(makeHint("fine-tuned", 1), "f _ _ _ - _ _ _ _ _");
  assert.equal(makeHint("fine-tuned", 3), "f i n _ - _ _ _ _ _");
  assert.equal(makeHint("fine-tuned", 99), "f i n e - t u n e _");
  assert.equal(makeHint("kot", 5), "k o _");
  assert.equal(makeHint("a", 3), "_");
  assert.equal(makeHint("dostrojony", 1), "d _ _ _ _ _ _ _ _ _");
  assert.equal(makeHint("ice cream", 2), "i c _   _ _ _ _ _");
});

test("hintTarget picks the shortest accepted answer", () => {
  assert.equal(hintTarget(["autentyczny", "szczery", "prawdziwy"]), "szczery");
});
