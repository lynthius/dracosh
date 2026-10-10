import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession } from "../src/session.js";
import { DEFAULTS } from "../src/settings.js";

// 90 simulated days of random play: nothing may throw and the bookkeeping must stay consistent.
test("a long random run keeps the progress data consistent", async () => {
  const words = Array.from({ length: 40 }, (_, i) => ({ noteId: i + 1, word: `word${i}`, translations: [`slowo${i}`, `inne${i}`], example: "" }));
  const state = { items: {}, newToday: { date: "", count: 0 } };
  let clock = new Date("2026-01-01T09:00:00").getTime();
  let seed = 42;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const session = createSession({
    loadWords: async () => ({ words }),
    state,
    getSettings: () => ({ ...DEFAULTS, dailyGoal: 15 }),
    save: async () => {},
    now: () => clock
  });

  let asked = 0;
  for (let day = 0; day < 90; day++) {
    if (random() < 0.15) { clock += 86_400_000; continue; } // a day off
    const perDay = Math.floor(random() * 40);
    for (let i = 0; i < perDay; i++) {
      let q;
      try {
        q = await session.next();
      } catch (err) {
        if (!err.empty) throw err;
        clock += 30 * 60_000; // nothing waiting right now: come back later
        continue;
      }
      const roll = random();
      const text = roll < 0.6 ? q.expected[0] : roll < 0.7 ? q.expected[0].slice(0, -1) : "wrong";
      const result = await session.answer(q, text, { hinted: random() < 0.1 });
      if (result.result === "wrong" && random() < 0.3) await session.overrule();
      asked += 1;
      clock += 5 * 60_000;
    }
    clock = new Date(new Date(clock).setHours(9, 0, 0, 0)).getTime() + 86_400_000;
  }

  const stats = session.stats();
  assert.ok(asked > 0);
  assert.ok(stats.streak.days >= 0 && stats.streak.days <= 90);
  assert.ok(stats.streak.best >= stats.streak.days);
  assert.ok(stats.streak.freezes >= 0 && stats.streak.freezes <= 2);
  assert.ok(stats.companion.index >= 0 && stats.companion.index <= 5);

  for (const entry of Object.values(state.items)) {
    assert.ok(entry.box >= 1 && entry.box <= 5, "box in range");
    assert.ok(entry.seen === entry.correct + entry.wrong, "seen = correct + wrong");
  }
  for (const [key, day] of Object.entries(state.progress.days)) {
    assert.ok(day.correct <= day.asked, `${key}: correct ≤ asked`);
    assert.ok(day.correct >= 0);
  }
  const totalCorrect = Object.values(state.progress.days).reduce((sum, d) => sum + d.correct, 0);
  assert.equal(totalCorrect, stats.totalCorrect);
  const month = session.month(0);
  assert.ok(month.weeks.every((w) => w.length === 7));
  assert.ok(session.missed(0).items.length >= 0);
});
