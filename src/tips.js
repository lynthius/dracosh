import { readFileSync } from "node:fs";

// Short tips about Dracosh itself, shown while you wait for the next card (and with /tip).
export const TIPS = JSON.parse(readFileSync(new URL("../data/tips.json", import.meta.url), "utf8"));
const SOMETIMES_CHANCE = 1 / 3;

// "always" shows a tip on every wait, "sometimes" on about one in three
export function shouldShowTip(mode, random = Math.random) {
  return mode === "always" || (mode === "sometimes" && random() < SOMETIMES_CHANCE);
}

// Shows every tip once before any repeats; what has been shown is remembered in state.tips.seen
// (ids of tips that no longer exist are dropped from it).
export function createTipDeck({ state, tips = TIPS, random = Math.random }) {
  const known = new Set(tips.map((tip) => tip.id));
  return {
    next() {
      const seen = new Set((state.tips?.seen ?? []).filter((id) => known.has(id)));
      let fresh = tips.filter((tip) => !seen.has(tip.id));
      if (!fresh.length) {
        seen.clear();
        fresh = tips;
      }
      const tip = fresh[Math.floor(random() * fresh.length)];
      seen.add(tip.id);
      state.tips = { seen: [...seen] };
      return tip;
    }
  };
}
