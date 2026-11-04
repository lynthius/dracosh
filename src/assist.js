import { ask, PROVIDERS, stream } from "./ai.js";
import { parseLine } from "./cardline.js";
import { isKnown, languageName } from "./language.js";

// What AI help writes for a card, and how it's asked. It completes what you start: the back (and an
// example) for a front you typed, in the style of the deck's own cards. Only that front and a few
// cards of the same deck are sent.
const EXAMPLES = 5; // cards of the deck shown to the model as the style to follow
const MAX_TEXT = 200; // a definition can be a sentence

const MAX_CARDS = 50; // a list asked for in one go
const AVOID = 80; // fronts of the deck the model is told not to repeat

const english = (code) => (isKnown(code) ? languageName(code, "en") : null);

// a line of text from the model, safe to put into a card line: one line, no separators of its own
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/ = /g, " ").replace(/ \/\/ /g, " ").trim().slice(0, MAX_TEXT);
const answer = (text) => clean(text).replace(/;/g, ","); // one answer; ";" would split it in two

// the model's answer → { back: [...], example }; JSON when it followed the instructions, a card line
// ("cat; kitty // The cat sleeps.") when it didn't
// A reasoning model's thoughts aren't the answer: <think>…</think> goes, and so does everything before a
// lone </think> (some templates open the thoughts in the prompt)
const answerPart = (text) => {
  const end = text.lastIndexOf("</think>");
  return (end >= 0 ? text.slice(end + 8) : text).replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
};

// the JSON object in a model's answer → the object, or null: the whole span from the first { to the
// last }, or when that isn't JSON (text with two objects), the last flat object that is
function jsonIn(text) {
  const tries = [text.match(/\{[\s\S]*\}/)?.[0], ...(text.match(/\{[^{}]*\}/g) ?? []).reverse()].filter(Boolean);
  for (const candidate of tries) {
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch {}
  }
  return null;
}

export function readSuggestion(text) {
  text = answerPart(String(text ?? ""));
  const data = jsonIn(text);
  if (data) {
    const back = [data.back].flat().map(answer).filter(Boolean).slice(0, 3);
    if (back.length) return { back, example: clean(data.example) };
  }
  const line = String(text ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  if (!line || line.startsWith("{")) return null;
  const [backPart, example = ""] = line.split(" // ");
  const back = backPart.split(";").map(clean).filter(Boolean).slice(0, 3);
  return back.length ? { back, example: clean(example) } : null;
}

// What a deck holds, from its newest cards (the front being written, while it has none): "question"
// (most fronts ask something), "definition" (terms explained in one language) or "word". A deck in two
// languages is always words: its questions and sentences are to be translated, not answered.
export function deckKind({ front = "", languages = {}, cards = [] }) {
  if (isKnown(languages.front) && isKnown(languages.back) && languages.front !== languages.back) return "word";
  const recent = cards.filter((card) => !card.cloze && card.back?.length).slice(-10);
  const asks = (text) => /\?\s*$/.test(text);
  if (recent.length ? recent.filter((card) => asks(card.front)).length * 2 > recent.length : asks(front)) return "question";
  const long = recent.length > 0 && recent.reduce((sum, card) => sum + card.back[0].length, 0) / recent.length > 30;
  if ((isKnown(languages.front) && languages.front === languages.back) || long) return "definition";
  return "word";
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
  const withExamples = examples.some((line) => line.includes('"example"'));
  const task = {
    word: [
      "You complete flashcards in a learner's vocabulary deck. Given the front of a card, write its back:",
      "the usual translation or answer first, then up to two other accepted answers; keep each short, without",
      "explanations. Add one short, natural example sentence that uses the word" + (learning ? ` in ${learning}.` : ".")
    ],
    definition: [
      "You complete flashcards in a learner's deck of terms and their definitions. Given the term on the front,",
      "write a short, accurate definition for the back: one sentence, at most about 20 words, the way a good",
      "dictionary or textbook puts it, without repeating the term.",
      withExamples ? "Add one short example sentence that uses the term." : 'Leave "example" empty.'
    ],
    question: [
      "You complete flashcards in a learner's deck of questions and answers. Given the question on the front,",
      "write its correct answer for the back: as short as it can be (a name, a number, a few words), then up to",
      'two other accepted forms of the same answer. Leave "example" empty.'
    ]
  }[deckKind({ front, languages, cards })];
  const system = [
    ...task,
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

// How the deck is written, for the model: its languages and a few of its cards as JSON
function deckContext({ languages = {}, cards = [] }) {
  const frontLanguage = english(languages.front);
  const backLanguage = english(languages.back);
  const examples = cards
    .filter((card) => !card.cloze && card.back?.length)
    .slice(-EXAMPLES)
    .map((card) => JSON.stringify({ front: card.front, back: card.back, ...(card.example ? { example: card.example } : {}) }));
  const sides = frontLanguage || backLanguage ? `Fronts are in ${frontLanguage ?? "the language of the deck's fronts"}, backs in ${backLanguage ?? "the language of the deck's backs"}.` : "";
  return { sides, examples, learning: english(languages.learning?.lang) };
}

// A list of new cards on a topic: `request` as you typed it ("20 words for the kitchen")
export function listPrompt({ request, languages, cards = [] }) {
  const { sides, examples, learning } = deckContext({ languages, cards });
  const fronts = cards.filter((card) => !card.cloze).slice(-AVOID).map((card) => card.front);
  const system = [
    "You write flashcards for a learner's vocabulary deck, on the topic or list they ask for.",
    `Write as many cards as asked; if no number is given, write 10; never more than ${MAX_CARDS}.`,
    "One card per line, in exactly this format and nothing else:",
    "front = main answer; other accepted answer // one short example sentence",
    "No numbering, bullets, headings, markdown or explanations. Keep answers short.",
    sides || "If the deck has cards, follow their languages; otherwise use the languages the request implies.",
    learning ? `The example sentence is in ${learning}.` : "",
    "Match the deck's own cards: their articles, capitalisation and style. Everyday, useful words first."
  ].filter(Boolean).join(" ");
  const prompt = [
    examples.length ? `Cards already in the deck:\n${examples.join("\n")}` : "",
    fronts.length ? `Don't repeat these fronts: ${fronts.join(", ")}` : "",
    `Request: ${request}`
  ].filter(Boolean).join("\n\n");
  return { system, prompt };
}

// a line of the model's list → card fields, or null for anything that isn't a card
export function readListLine(line) {
  const text = String(line ?? "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim();
  if (!text.includes(" = ") || /^```/.test(text)) return null;
  const fields = parseLine(text);
  if (!fields.front || !fields.back.length || fields.cloze) return null;
  return { front: clean(fields.front), back: fields.back.map(answer).filter(Boolean).slice(0, 3), example: clean(fields.example) };
}

// Asks for a list, each card heard (`onCard`) as soon as its line is complete; thoughts of a reasoning
// model are skipped. → the number of cards
export async function suggestCards(ai, { request, languages, cards, signal, onCard }) {
  const { system, prompt } = listPrompt({ request, languages, cards });
  let sent = 0;
  const enough = new AbortController(); // MAX_CARDS heard: the rest isn't read (or paid for)
  const hear = (text, all = false) => {
    const parts = answerPart(text).split(/\r\n|\r|\n/);
    if (!all) {
      parts.pop(); // the last line may still be coming
      // prose before any </think> may be thoughts whose template opened them in the prompt: its
      // cards wait for the end (a preamble like "Here are 10 words:" doesn't count)
      if (!text.includes("</think>") && parts.some((line) => line.trim() && !readListLine(line) && !/:\s*$/.test(line))) return;
    }
    const found = parts.map(readListLine).filter(Boolean);
    while (sent < found.length && sent < MAX_CARDS) onCard(found[sent++]);
    if (sent >= MAX_CARDS) enough.abort();
  };
  const local = PROVIDERS[ai.provider].local;
  try {
    const whole = await stream(ai, { system, prompt, signal: signal ? AbortSignal.any([signal, enough.signal]) : enough.signal, maxTokens: local ? 6000 : 8000, timeoutMs: local ? 300_000 : 120_000, onText: (piece, sofar) => hear(sofar) });
    hear(whole, true);
  } catch (err) {
    if (!enough.signal.aborted || signal?.aborted) throw err;
  }
  return sent;
}

// Checking a card that's already written: is it right? `language`: the code of the language Dracosh
// speaks, for the note. → { system, prompt }
export function checkPrompt({ card, languages, cards = [], language = "en" }) {
  const { sides, examples } = deckContext({ languages, cards: cards.filter((other) => other.id !== card.id) });
  const system = [
    "You check one flashcard from a learner's deck for mistakes: a wrong translation, definition or answer,",
    "a misspelling, a wrong article or gender, an example sentence with an error, or a question so unclear",
    "that more than one answer would be right. Don't change what isn't wrong: other wording, style or a",
    "missing synonym is fine.",
    sides,
    `Reply with JSON only. If the card is right: {"ok": true}. If not: {"ok": false, "note": "one short sentence`,
    `in ${english(language) ?? "English"} on what is wrong", "front": "...", "back": ["..."], "example": "..."},`,
    "the whole card with the mistake fixed, in the deck's own style."
  ].filter(Boolean).join(" ");
  const prompt = [examples.length ? `Other cards in the deck:\n${examples.join("\n")}` : "", `Card: ${JSON.stringify({ front: card.front, back: card.back, ...(card.example ? { example: card.example } : {}) })}`].filter(Boolean).join("\n\n");
  return { system, prompt };
}

// the model's verdict → { ok: true } | { ok: false, note, fix } | null (unreadable). `fix`: the card
// as AI would have it, { front, back, example }, or null when it only says what's wrong. What the model
// gives back unchanged stays exactly as it was (not shortened or tidied).
export function readCheck(text, card) {
  const data = jsonIn(answerPart(String(text ?? "")));
  if (!data) return null;
  if (data.ok === true || data.ok === "true") return { ok: true };
  if (data.ok !== false && data.ok !== "false") return null;
  const tidy = (value) => String(value).replace(/\s+/g, " ").trim();
  const keep = (value, old, fresh) => (typeof value !== "string" || !value.trim() ? old : tidy(value) === tidy(old) ? old : fresh(value));
  const given = (Array.isArray(data.back) ? data.back : typeof data.back === "string" ? data.back.split(";") : []).filter((value) => typeof value === "string" && value.trim());
  const back = given.length ? given.map((value) => card.back.find((old) => tidy(old) === tidy(value)) ?? answer(value)).filter(Boolean) : card.back;
  const fix = { front: keep(data.front, card.front, clean), back, example: data.example === undefined ? card.example ?? "" : keep(data.example, card.example ?? "", clean) };
  if (data.example === "") fix.example = "";
  const same = fix.front === card.front && fix.back.join("\n") === card.back.join("\n") && fix.example === (card.example ?? "");
  const note = typeof data.note === "string" ? clean(data.note) : "";
  if (same) return note ? { ok: false, note, fix: null } : { ok: true };
  return { ok: false, note, fix };
}

// → the verdict on a card (see readCheck); throws AiError, or a plain one when the answer was unreadable
export async function checkCard(ai, { card, languages, cards, language, signal }) {
  const { system, prompt } = checkPrompt({ card, languages, cards, language });
  const local = PROVIDERS[ai.provider].local;
  const verdict = readCheck(await ask(ai, { system, prompt, maxTokens: local ? 3000 : 1000, signal, timeoutMs: local ? 90_000 : 30_000 }), card);
  if (!verdict) throw Object.assign(new Error("unreadable"), { code: "unreadable" });
  return verdict;
}
