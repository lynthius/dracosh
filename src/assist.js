import { ask, PROVIDERS } from "./ai.js";
import { isKnown, languageName } from "./language.js";

// What AI help writes for a card, and how it's asked. It completes what you start: the back (and an
// example) for a front you typed, in the style of the deck's own cards. Only that front and a few
// cards of the same deck are sent.
const EXAMPLES = 5; // cards of the deck shown to the model as the style to follow
const MAX_TEXT = 120;

const english = (code) => (isKnown(code) ? languageName(code, "en") : null);

// a line of text from the model, safe to put into a card line: one line, no separators of its own
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/ = /g, " ").replace(/ \/\/ /g, " ").trim().slice(0, MAX_TEXT);
const answer = (text) => clean(text).replace(/;/g, ","); // one answer; ";" would split it in two

// the model's answer → { back: [...], example }; JSON when it followed the instructions, a card line
// ("cat; kitty // The cat sleeps.") when it didn't
export function readSuggestion(text) {
  text = String(text ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/g, ""); // a reasoning model's thoughts aren't the answer
  const json = String(text ?? "").match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const data = JSON.parse(json);
      const back = [data.back].flat().map(answer).filter(Boolean).slice(0, 3);
      if (back.length) return { back, example: clean(data.example) };
    } catch {}
  }
  const line = String(text ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  if (!line || line.startsWith("{")) return null;
  const [backPart, example = ""] = line.split(" // ");
  const back = backPart.split(";").map(clean).filter(Boolean).slice(0, 3);
  return back.length ? { back, example: clean(example) } : null;
}

// `languages`: the deck's { front, back, learning } (codes, any of them unknown); `cards`: the deck's
// cards, the newest are the examples
export function suggestionPrompt({ front, languages = {}, cards = [] }) {
  const frontLanguage = english(languages.front);
  const backLanguage = english(languages.back);
  const learning = english(languages.learning?.lang);
  const examples = cards
    .filter((card) => !card.cloze && card.back?.length)
    .slice(-EXAMPLES)
    .map((card) => JSON.stringify({ front: card.front, back: card.back, ...(card.example ? { example: card.example } : {}) }));
  const system = [
    "You complete flashcards in a learner's vocabulary deck. Given the front of a card, write its back:",
    "the usual translation or answer first, then up to two other accepted answers; keep each short, without",
    "explanations. Add one short, natural example sentence that uses the word" + (learning ? ` in ${learning}.` : "."),
    frontLanguage || backLanguage ? `The deck's fronts are in ${frontLanguage ?? "the same language as the examples"}, its backs in ${backLanguage ?? "the same language as the examples"}.` : "Follow the languages of the deck's cards.",
    "Match the deck's own cards: their articles, capitalisation and style.",
    'Reply with JSON only: {"back": ["..."], "example": "..."}'
  ].join(" ");
  const prompt = [examples.length ? `Cards already in the deck:\n${examples.join("\n")}` : "", `Front: ${front}`].filter(Boolean).join("\n\n");
  return { system, prompt };
}

// → { back, example } or null when the answer had nothing usable
export async function suggestCard(ai, { front, languages, cards, signal }) {
  const { system, prompt } = suggestionPrompt({ front, languages, cards });
  // room for a reasoning model's thinking (paid only as used); a model on this computer may be slow to load
  const local = PROVIDERS[ai.provider].local;
  return readSuggestion(await ask(ai, { system, prompt, maxTokens: local ? 2000 : 800, signal, timeoutMs: local ? 60_000 : 20_000 }));
}
