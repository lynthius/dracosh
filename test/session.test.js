import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession } from "../src/session.js";
import { DEFAULTS } from "../src/settings.js";

const words = [
  { noteId: 1, word: "genuine", translations: ["autentyczny", "szczery"], example: "Her apology felt genuine." },
  { noteId: 2, word: "software", translations: ["oprogramowanie"], example: "" }
];

// a fixed midday clock, so time-of-day badges (night owl, early bird) never sneak into the results
const NOON = new Date("2026-03-04T12:00:00").getTime();

function setup(settings = {}, now = () => NOON) {
  const saves = [];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({
    loadWords: async () => ({ words }),
    state,
    getSettings: () => ({ ...DEFAULTS, ...settings }),
    save: async (s) => saves.push(structuredClone(s)),
    now
  });
  return { session, state, saves };
}

test("asks in both directions with matching expected answers", async () => {
  const { session } = setup();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const q = await session.next();
    seen.add(q.direction);
    if (q.direction === "en-pl") assert.deepEqual(q.expected, q.word.translations);
    else assert.deepEqual(q.expected, [q.word.word]);
  }
  assert.deepEqual([...seen].sort(), ["en-pl", "pl-en"]);
});

test("never asks the same note twice in a row", async () => {
  const { session } = setup();
  let last = null;
  for (let i = 0; i < 30; i++) {
    const q = await session.next();
    assert.notEqual(q.word.noteId, last);
    last = q.word.noteId;
  }
});

test("answer grades, persists and tracks the combo", async () => {
  const { session, state, saves } = setup();
  const q = await session.next();
  const good = await session.answer(q, q.expected[0].toUpperCase());
  assert.equal(good.result, "exact");
  assert.equal(good.combo, 1);
  assert.equal(saves.length, 1);
  assert.equal(Object.values(state.items)[0].phase, "review", "a new card answered right waits a couple of days");

  const q2 = await session.next();
  const bad = await session.answer(q2, "zzzzzz");
  assert.equal(bad.result, "wrong");
  assert.deepEqual(session.totals, { asked: 2, correct: 1, combo: 0 });
  assert.equal(session.stats().today.correct, 1);
});

test("reaching the daily goal cheers and starts the streak", async () => {
  const { session } = setup({ dailyGoal: 2 });
  const q1 = await session.next();
  await session.answer(q1, q1.expected[0]);
  const q2 = await session.next();
  const reward = await session.answer(q2, q2.expected[0]);
  assert.ok(reward.cheers.some((c) => c.kind === "goal"));
  assert.equal(session.stats().streak.days, 1);
  assert.ok(session.stats().today.goalMet);
});

test("/correct overrules a wrong answer and remembers it for that card", async () => {
  const { session, state } = setup({ dailyGoal: 1 });
  const q = await session.next();
  const wrong = await session.answer(q, "zupelnie inna odpowiedz");
  assert.equal(wrong.result, "wrong");
  assert.ok(session.canOverrule());
  assert.equal(session.stats().today.correct, 0);

  const fixed = await session.overrule();
  assert.equal(fixed.accepted, "zupelnie inna odpowiedz");
  assert.ok(fixed.cheers.some((c) => c.kind === "goal")); // the corrected answer counts towards the goal
  assert.equal(session.canOverrule(), false);
  assert.deepEqual(session.totals, { asked: 1, correct: 1, combo: 1 });
  assert.equal(session.stats().today.asked, 1);
  assert.equal(session.stats().today.correct, 1);

  const key = Object.keys(state.items)[0];
  assert.equal(state.items[key].phase, "review");
  assert.equal(state.items[key].wrong, 0); // as if the answer had been right from the start
  assert.equal(state.items[key].correct, 1);
  assert.deepEqual(state.accepted[key], ["zupelnie inna odpowiedz"]);

  // the same answer on the same card is now accepted straight away
  const again = { ...q };
  const second = await session.answer(again, "ZUPELNIE inna odpowiedz!");
  assert.equal(second.result, "exact");
});

test("/correct is only possible right after a wrong answer, and only once", async () => {
  const { session } = setup();
  await assert.rejects(() => session.overrule(), /no wrong answer/);
  const q = await session.next();
  await session.answer(q, "zzzzzz");
  await session.overrule();
  await assert.rejects(() => session.overrule(), /no wrong answer/);

  const q2 = await session.next();
  await session.answer(q2, "zzzzzz");
  await session.next(); // a new question closes the window
  assert.equal(session.canOverrule(), false);
});

test("wrong answers are logged for /missed, and /correct removes the entry", async () => {
  const { session } = setup();
  const q = await session.next();
  await session.answer(q, "zzzzzz");
  let missed = session.missed(0);
  assert.equal(missed.items.length, 1);
  assert.equal(missed.items[0].answer, "zzzzzz");
  assert.deepEqual(missed.items[0].expected, q.expected);

  await session.overrule();
  missed = session.missed(0);
  assert.equal(missed.items.length, 0);
});

test("a hinted correct answer counts, but the card comes back sooner, and says when", async () => {
  const { session, state } = setup();
  const q = await session.next();
  const result = await session.answer(q, q.expected[0], { hinted: true });
  assert.equal(result.result, "exact");
  assert.equal(result.hinted, true);
  assert.deepEqual(result.held, { days: 0, would: 2 }, "later today, not in 2 days");
  const key = Object.keys(state.items)[0];
  assert.equal(state.items[key].phase, "learning");
  assert.equal(state.items[key].correct, 1);

  const q2 = { ...q };
  const again = await session.answer(q2, q.expected[0]);
  assert.equal(again.hinted, false);
  assert.equal(again.held, null);
  assert.equal(state.items[key].phase, "review");
});

test("a typo or an \"almost\" counts as right, but like a hint the card comes back sooner", async () => {
  const words = [{ noteId: "h", word: "pies", translations: ["der Hund"], example: "" }];
  const answer = async (text) => {
    const state = { items: {}, newToday: { date: "", count: 0 } };
    const session = createSession({ loadWords: async () => ({ words, deck: { name: "German", languages: { front: "pl", back: "de" }, learning: { lang: "de" }, directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => NOON });
    const outcome = await session.answer(await session.next(), text);
    return { ...outcome, entry: Object.values(state.items)[0] };
  };
  const clean = await answer("der Hund");
  assert.equal(clean.held, null);
  const typo = await answer("der Hunf");
  assert.equal(typo.result, "typo");
  assert.ok(typo.held && typo.entry.due < clean.entry.due, "a typo: sooner");
  const almost = await answer("Hund");
  assert.equal(almost.result, "article");
  assert.ok(almost.held && almost.entry.due < clean.entry.due, "an article left out: sooner");
  assert.equal(almost.entry.correct, 1);
});

test("/pause takes a short break or days off, lists them and turns them off", async () => {
  const { session, state } = setup();
  assert.deepEqual(await session.pause("30m"), { snooze: 1_800_000 });
  assert.match((await session.pause("")).message, /No days off planned/);
  assert.match((await session.pause("7d")).message, /^Days off .* your streak is safe/);
  assert.equal(state.progress.vacations.length, 1);
  assert.match((await session.pause("")).message, /^Days off: /);
  assert.equal(session.stats().restToday, true);
  const off = await session.pause("off");
  assert.equal(off.snooze, "off");
  assert.equal(session.stats().vacation.activeUntil, null);
  await assert.rejects(() => session.pause("30"), /Try \/pause 30m/, "a bare number could be minutes or days");
  await assert.rejects(() => session.pause("whenever"), /Try \/pause/);
});

test("the hatching intro plays only on a brand-new state, and only once", async () => {
  const { session, state, saves } = setup();
  assert.equal(session.isFirstRun(), true);
  await session.markHatched();
  assert.equal(session.isFirstRun(), false);
  assert.equal(saves.at(-1).hatched, true);

  const veteran = setup();
  const q = await veteran.session.next();
  await veteran.session.answer(q, q.expected[0]);
  assert.equal(veteran.session.isFirstRun(), false, "someone who already answered never sees the egg");
  assert.equal(state.hatched, true);
});

test("/badges lights up badges won since the last visit, in the order they were won, once", async () => {
  const { session, state } = setup();
  assert.deepEqual(await session.openBadges(), [], "nothing won yet");
  const q = await session.next();
  await session.answer(q, q.expected[0]); // first correct answer: "Hello!"
  assert.deepEqual(await session.openBadges(), ["hello"]);
  assert.deepEqual(await session.openBadges(), [], "seen now, so it doesn't light up again");
  assert.ok(state.progress.seenBadges.includes("hello"));
});

test("a progress reset starts the game over and keeps what you know; everything clears it all", async () => {
  const { session, state } = setup();
  const q = await session.next();
  await session.answer(q, q.expected[0]);
  assert.ok(state.progress && Object.keys(state.items).length === 1);

  await session.reset("progress");
  assert.equal(state.progress, undefined);
  assert.equal(Object.keys(state.items).length, 1, "the card keeps its schedule");
  assert.equal(session.stats().badges.filter((b) => b.unlockedOn).length, 0);

  state.hatched = true;
  await session.reset("everything");
  assert.deepEqual(state.items, {});
  assert.equal(state.version, 2, "a fresh state of this version, not one to upgrade");
  assert.equal(session.isFirstRun(), true, "the egg hatches again");
});

test("when everything for today is done, the day counts as the goal; a missed card still comes back today", async () => {
  let clock = NOON;
  const one = [{ noteId: "c1", word: "kot", translations: ["cat"], example: "" }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: one, deck: { name: "Polish", languages: null, directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => clock });

  const miss = await session.answer(await session.next(), "dog"); // back in 10 minutes
  assert.ok(miss.nextDue > clock && miss.nextDue < clock + 3_600_000, "the missed card is due later today");
  assert.ok(!miss.cheers.some((c) => c.kind === "goal"), "not done yet");

  clock += 600_000;
  const last = await session.answer(await session.next(), "cat");
  assert.match(last.cheers.find((c) => c.kind === "goal").text, /All done for today · 1-day streak/, "settled with the last answer");
  assert.ok(last.nextDue >= clock + 3_600_000);
  const empty = await session.next().catch((err) => err);
  assert.ok(empty.empty);
  assert.deepEqual(empty.cheers, [], "celebrated once");
});

test("just opening Dracosh with nothing due makes a rest day, never a goal", async () => {
  const clock = NOON;
  const one = [{ noteId: "c1", word: "kot", translations: ["cat"], example: "" }];
  const state = { items: { "c1:en-pl": { phase: "review", due: clock + 3 * 86_400_000, seen: 3, correct: 3, wrong: 0, streak: 3 } }, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: one, deck: { name: "Polish", directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => clock });
  const empty = await session.next().catch((err) => err);
  assert.deepEqual(empty.cheers, []);
  assert.equal(session.stats().today.goalMet, false);
  assert.equal(session.stats().restToday, true, "the streak isn't broken either");
});

test("a deck that's done doesn't settle the day while another deck still has cards due", async () => {
  const clock = NOON;
  const done = { words: [{ noteId: "a", word: "kot", translations: ["cat"], example: "" }], deck: { name: "Done", directions: "forward" } };
  const busy = { words: [{ noteId: "b", word: "pies", translations: ["dog"], example: "" }], deck: { name: "Busy", directions: "forward" } };
  const state = { items: { "a:en-pl": { phase: "review", due: clock + 86_400_000 * 3, seen: 1, correct: 1, wrong: 0, streak: 1 }, "b:en-pl": { phase: "review", due: clock - 1000, seen: 1, correct: 1, wrong: 0, streak: 1 } }, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => done, loadAllWords: async () => [done, busy], state, getSettings: () => DEFAULTS, save: async () => {}, now: () => clock });
  const empty = await session.next().catch((err) => err);
  assert.deepEqual(empty.cheers, []);
  assert.equal(session.stats().restToday, false);
  assert.equal(empty.dayDone, false, "the screen says this deck is done, not the day");
});

test("days off can't reach into the past, so a broken streak stays broken", async () => {
  const { session, state } = setup();
  const today = new Date(NOON).toLocaleDateString("sv");
  assert.match((await session.pause("1.1 31.12")).message, /Days off .*: your streak is safe\./);
  assert.ok(state.progress.vacations.every((v) => v.from >= today), "it starts today at the earliest");
  await assert.rejects(session.pause("2026-01-01 2026-01-05"), /already over/);
  assert.match((await session.pause("24.12")).message, /^Day off on /);
});

test("a day of misses only isn't a day done, even when the miss comes back after midnight", async () => {
  const clock = new Date("2026-03-04T23:55:00").getTime();
  const one = [{ noteId: "c1", word: "kot", translations: ["cat"], example: "" }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: one, deck: { name: "Polish", directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => clock });
  const miss = await session.answer(await session.next(), "zzz");
  assert.ok(!miss.cheers.some((c) => c.kind === "goal"));
  assert.equal(session.stats().today.goalMet, false);
});

test("revealing writes nothing; 'knew it' then counts exactly like a typed right answer", async () => {
  const typed = setup();
  const self = setup();
  const q1 = await typed.session.next();
  await typed.session.answer(q1, q1.expected[0]);
  const q2 = await self.session.next();
  const shown = self.session.reveal(q2);
  assert.deepEqual(shown.expected, q2.expected);
  assert.equal(self.saves.length, 0, "a reveal alone saves nothing");
  const result = await self.session.selfGrade(q2, true);
  assert.equal(result.self, true);
  assert.equal(result.result, "exact");
  const entry = (state) => Object.values(state.items)[0];
  assert.deepEqual(entry(self.state), entry(typed.state), "the same schedule");
  assert.deepEqual(self.session.totals, typed.session.totals, "same totals and combo");
  assert.deepEqual(self.session.stats().today, typed.session.stats().today, "same daily goal progress");
});

test("'didn't know' is a miss: back in 10 minutes, listed in /missed, nothing to /correct", async () => {
  const { session, state } = setup();
  const q = await session.next();
  const result = await session.selfGrade(q, false);
  assert.equal(result.result, "wrong");
  assert.equal(Object.values(state.items)[0].due, NOON + 10 * 60_000);
  assert.equal(session.totals.combo, 0);
  assert.equal(session.missed(0).items?.length ?? session.missed(0).length, 1);
  assert.equal(session.canOverrule(), false);
});

test("a hint before revealing brings the card back sooner, as with a typed answer", async () => {
  const { session, state } = setup();
  const q = await session.next();
  const result = await session.selfGrade(q, true, { hinted: true });
  assert.equal(Object.values(state.items)[0].phase, "learning");
  assert.deepEqual(result.held, { days: 0, would: 2 });
});

test("a cloze card is asked one gap at a time, with the others filled in and the back as a hint", async () => {
  const cloze = [{ noteId: "z", word: "I {{look forward}} to {{it}}", translations: ["Cieszę się na to"], cloze: ["look forward", "it"], directions: ["c1", "c2"] }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: cloze, deck: { name: "Phrases", directions: "both" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => NOON });
  const asked = new Map();
  for (let i = 0; i < 2; i++) {
    const q = await session.next();
    asked.set(q.direction, q);
    await session.answer(q, q.expected[0]);
  }
  assert.deepEqual([...asked.keys()].sort(), ["c1", "c2"], "the deck's directions don't apply to a cloze card");
  assert.equal(asked.get("c1").prompt, "I ____ to it");
  assert.deepEqual(asked.get("c1").expected, ["look forward"]);
  assert.equal(asked.get("c2").prompt, "I look forward to ____");
  assert.equal(asked.get("c1").context, "Cieszę się na to");
  assert.equal(asked.get("c1").label, "Phrases");
  assert.deepEqual(Object.keys(state.items).sort(), ["z:c1", "z:c2"]);
});

test("a deck asked one way never asks the other, and switching it later without losing progress", async () => {
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const deck = { name: "Terms", directions: "backward" };
  const session = createSession({ loadWords: async () => ({ words, deck }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => NOON });
  for (let i = 0; i < 2; i++) {
    const q = await session.next();
    assert.equal(q.direction, "pl-en");
    await session.answer(q, q.expected[0]);
  }
  const kept = structuredClone(state.items);
  deck.directions = "both";
  assert.equal((await session.next()).direction, "en-pl", "the other way starts as new cards");
  assert.deepEqual(state.items, kept, "turning a direction on touches the progress of none");
  deck.directions = "forward";
  assert.equal((await session.next()).direction, "en-pl");
  assert.deepEqual(state.items, kept, "nor does turning one off");
});

test("a direction the deck no longer asks doesn't stop a card from being mastered, and comes back when asked again", async () => {
  const { session, state } = setup();
  const month = { phase: "review", last: NOON - 1, due: NOON + 40 * 86_400_000, seen: 6, correct: 6, wrong: 0, streak: 6, stability: 40, difficulty: 3 };
  state.items = { "1:en-pl": month, "1:pl-en": { ...month, due: NOON - 1, last: NOON - 2 * 86_400_000 } };
  assert.equal(session.stats().mastered, 0);
  await session.setDirections([1], "forward");
  assert.equal(session.stats().mastered, 1);
  assert.equal(state.items["1:pl-en"].due, NOON - 1, "its progress stays");
  await session.setDirections([1], "both");
  assert.equal(session.stats().mastered, 0);
});

test("a gap removed from a cloze card takes its progress with it", async () => {
  const { session, state } = setup();
  state.items = { "z:c1": { phase: "review" }, "z:c2": { phase: "review" } };
  await session.forgetKeys(["z:c2"]);
  assert.deepEqual(Object.keys(state.items), ["z:c1"]);
});

test("a missed cloze gap is listed with its hint", async () => {
  const cloze = [{ noteId: "z", word: "I {{look forward}} to it", translations: ["Cieszę się"], cloze: ["look forward"], directions: ["c1"] }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words: cloze, deck: { name: "Phrases" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => NOON });
  await session.selfGrade(await session.next(), false);
  const [miss] = session.missed(0).items ?? session.missed(0);
  assert.equal(miss.prompt, "I ____ to it (Cieszę się)");
});

test("pronunciation reads the side in the language you're learning, and nothing in a deck that isn't for a language", async () => {
  const { toSpeak } = await import("../src/session.js");
  const q = (direction, answerLanguage, promptLanguage, learningLanguage, extra = {}) => ({ direction, answerLanguage, promptLanguage, learningLanguage, expected: ["der Hund"], prompt: "pies", word: { word: "pies" }, ...extra });
  assert.deepEqual(toSpeak(q("en-pl", "de", "pl", "de")), { text: "der Hund", lang: "de" });
  assert.deepEqual(toSpeak(q("pl-en", "pl", "de", "de", { expected: ["pies"], prompt: "der Hund / Hund" })), { text: "der Hund", lang: "de" });
  assert.deepEqual(toSpeak(q("c1", "de", null, "de", { word: { word: "Ich {{gehe}} nach Hause" } })), { text: "Ich gehe nach Hause", lang: "de" });
  assert.equal(toSpeak(q("en-pl", "pl", "pl", null)), null, "definitions in one language: nothing to read");
  assert.equal(toSpeak(q("en-pl", "de", "pl", "de", { tour: true })), null);
  const card = { direction: "en-pl", answerLanguage: "en", promptLanguage: "pl", learningLanguage: "en", expected: ["cat", "kitty"], prompt: "kot", word: { word: "kot" } };
  assert.deepEqual(toSpeak(card, "kitty"), { text: "kitty", lang: "en" }, "the right answer you gave");
  assert.deepEqual(toSpeak(card, "dog"), { text: "cat", lang: "en" });
  const cloze = { direction: "c1", answerLanguage: "pl", promptLanguage: "en", learningLanguage: "en", expected: ["kot"], prompt: "Mój ____ śpi", word: { word: "Mój {{kot}} śpi" } };
  assert.equal(toSpeak(cloze), null, "a gapped sentence isn't read");
});

test("a tour card never comes back, so a hint there says nothing about when", async () => {
  const words = [{ noteId: "t", word: "Type apple", translations: ["apple"], example: "" }];
  const state = { items: {}, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words, deck: { name: "Getting started", tour: true } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => NOON });
  const q = await session.next();
  assert.equal(q.tour, true);
  const result = await session.answer(q, "apple", { hinted: true });
  assert.equal(result.hinted, true);
  assert.equal(result.held, null);
});

test("a small difference isn't worth a line: only minutes against days, or a real gap", async () => {
  const { grade, Rating } = await import("../src/scheduler.js");
  let entry = grade(undefined, Rating.Good, NOON);
  for (let i = 0; i < 6; i++) entry = grade(entry, Rating.Good, entry.due);
  const words = [{ noteId: "1", word: "kot", translations: ["cat"], example: "" }];
  const state = { items: { "1:en-pl": entry }, newToday: { date: "", count: 0 } };
  const session = createSession({ loadWords: async () => ({ words, deck: { name: "Polish", directions: "forward" } }), state, getSettings: () => DEFAULTS, save: async () => {}, now: () => entry.due });
  const result = await session.answer(await session.next(), "cat", { hinted: true });
  assert.ok(result.held === null || (result.held.would - result.held.days >= 2 && result.held.would >= result.held.days * 1.25), JSON.stringify(result.held));
});
