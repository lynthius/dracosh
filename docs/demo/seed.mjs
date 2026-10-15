// Fills a throwaway DRACOSH_HOME with the demo used for docs/demo.gif: a Spanish deck a few weeks in,
// a 12-day streak (the dragon is an imp by now) and a study session. Run by docs/demo/demo.tape.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.DRACOSH_HOME;
if (!home || !home.startsWith("/tmp/")) throw new Error("Set DRACOSH_HOME to a folder in /tmp: the demo replaces what's there.");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

const { createDeck, addCard, emptyLibrary } = await import("../../src/library.js");
const library = emptyLibrary();
const deck = createDeck(library, { name: "Spanish", languages: { front: "es", back: "en" }, directions: "forward" });
const cards = [
  ["el gato", "the cat"],
  ["mañana", "tomorrow"],
  ["la biblioteca", "the library"],
  ["el perro", "the dog"],
  ["la ventana", "the window"],
  ["despacio", "slowly"],
  ["el cumpleaños", "the birthday"],
  ["la cuchara", "the spoon"]
];
const ids = cards.map(([front, back]) => addCard(library, deck.id, { front, back: [back] }).card.id);

const day = 86_400_000;
const now = Date.now();
const key = (t) => new Date(t).toISOString().slice(0, 10);
const weekStart = (t) => {
  const d = new Date(t);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return key(d);
};
// every card waiting, in the order the demo answers them
const items = Object.fromEntries(ids.map((id, i) => [`${id}:en-pl`, { box: 2, seen: 4, correct: 3, wrong: 1, streak: 1, due: now - 60_000 * (ids.length - i), last: now - 2 * day }]));
const days = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [key(now - (i + 1) * day), { asked: 22, correct: 20, goalMet: true }]));
// what twelve days of practice have earned already, so no badge pops up mid-demo
const EARNED = ["hello", "first-steps", "century", "on-a-roll", "week", "hot-streak", "weekend", "perfect-week"];
const state = {
  version: 1,
  items,
  newToday: { date: "", count: 0 },
  hatched: true,
  progress: {
    days,
    streak: { count: 12, best: 12, lastGoalDay: key(now - day), freezes: 2, freezeWeek: weekStart(now), freezesUsed: 0 },
    badges: Object.fromEntries(EARNED.map((id) => [id, key(now - 5 * day)])),
    seenBadges: EARNED,
    bestCombo: 12,
    lastActiveDay: key(now - day),
    vacations: []
  }
};
writeFileSync(join(home, "library.json"), JSON.stringify(library));
writeFileSync(join(home, "state.json"), JSON.stringify(state));
writeFileSync(join(home, "settings.json"), JSON.stringify({ language: "en", deck: "Spanish", rhythm: "session", sound: false, tips: "off", dailyGoal: 20, skipWeekends: false }));
