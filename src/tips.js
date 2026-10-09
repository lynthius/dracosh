import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./store.js";

const BUNDLED = JSON.parse(readFileSync(new URL("../data/tips.json", import.meta.url), "utf8"));
const USER_FILE = join(HOME, "tips.json");
const SOMETIMES_CHANCE = 1 / 3;

// Your own tips: ~/.dracosh/tips.json, an array of { "cat": "...", "text": "..." } (the id is optional).
// A broken or missing file just means no extra tips.
export function loadUserTips(file = USER_FILE) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((tip) => tip && typeof tip.text === "string" && tip.text.trim())
    .map((tip, i) => ({ id: `u-${tip.id ?? i + 1}`, cat: typeof tip.cat === "string" && tip.cat ? tip.cat : "My tips", text: tip.text.trim() }));
}

export const allTips = () => [...BUNDLED, ...loadUserTips()];

// "always" shows a tip on every wait, "sometimes" on about one in three
export function shouldShowTip(mode, random = Math.random) {
  return mode === "always" || (mode === "sometimes" && random() < SOMETIMES_CHANCE);
}

// Shows every tip once before any repeats; what has been shown is remembered in state.tips.seen.
export function createTipDeck({ state, tips = allTips(), random = Math.random }) {
  return {
    next() {
      const seen = new Set(state.tips?.seen ?? []);
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
