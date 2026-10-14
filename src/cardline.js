// One card written as one line, the way /add (and later import) takes it:
//
//   kot = cat; kitty // Mój kot śpi.
//
// Only " = " with spaces around it splits front and back, so "E=mc²" or "x=1" stays whole. ";"
// separates right answers (commas belong to sentences: "Yes, I do"). " // " with spaces starts the
// example, so "https://…" stays whole. "{{…}}" in the front makes a gap: a cloze card, asked one gap
// at a time. A backslash keeps any of these as plain text: \= \; \// \{{ (and \\ is a backslash).
//
// A cloze card keeps its escaped braces ("\{{") in the stored front, so they never turn into gaps.

const ESCAPES = { "\\\\": "\u0005", "\\=": "\u0001", "\\;": "\u0002", "\\//": "\u0003", "\\{{": "\u0004" };
const RESTORE = { "\u0005": "\\", "\u0001": "=", "\u0002": ";", "\u0003": "//", "\u0004": "{{" };
const hide = (text) => text.replace(/\\(\\|=|;|\/\/|\{\{)/g, (match) => ESCAPES[match]);
const show = (text, keep = {}) => text.replace(/[\u0001-\u0005]/g, (ch) => keep[ch] ?? RESTORE[ch]);

// a gap holds some text and no braces: "{{ }}" or "{{a {{b}} c}}" aren't gaps (only "{{b}}" is)
export const GAP = /(?<!\\)\{\{\s*([^\s{}][^{}]*?)\s*\}\}/g;
const hasGap = (front) => new RegExp(GAP.source).test(front);
const unescapeBraces = (text) => text.replace(/\\\{\{/g, "{{");

// a cloze card's gaps, in order: "I {{look forward}} to {{it}}" → ["look forward", "it"]
export const gapsOf = (front) => [...front.matchAll(GAP)].map((match) => match[1]);

// The front with gap `index` blanked and the others filled in: "I ____ to it"
export const blankGap = (front, index) => {
  let i = 0;
  return unescapeBraces(front.replace(GAP, (_, gap) => (i++ === index ? "____" : gap)));
};

// The front as read: the gaps filled in, no braces
export const plainFront = (front) => unescapeBraces(front.replace(GAP, (_, gap) => gap));

const splitAnswers = (text) => text.split(";").map((part) => show(part).trim()).filter(Boolean);

// `separator` is " = " for typed lines; a pasted export can use a tab instead.
// → { front, back: [], example, cloze, hasBack }: `hasBack` is false when the line has no separator,
// so /add asks for the back next (a cloze card doesn't need one: the gaps are its answers).
export function parseLine(line, { separator = " = " } = {}) {
  let hidden = hide(String(line ?? "").trim());
  // "kot =" is a front still waiting for its back
  if (separator === " = " && !hidden.includes(separator) && hidden.endsWith(" =")) hidden = hidden.slice(0, -2).trimEnd();
  const at = hidden.indexOf(separator);
  const frontPart = at === -1 ? hidden : hidden.slice(0, at);
  const rest = at === -1 ? "" : ` ${hidden.slice(at + separator.length)}`; // the space lets the back start with "// "
  const exampleAt = rest.indexOf(" // ");
  const backPart = exampleAt === -1 ? rest : rest.slice(0, exampleAt);
  const example = exampleAt === -1 ? "" : show(rest.slice(exampleAt + 4)).trim();
  // braces escaped with \{{ are plain text, so only the visible ones make gaps
  const cloze = hasGap(frontPart.replace(/\u0004/g, ""));
  const front = show(frontPart, cloze ? { "\u0004": "\\{{" } : {}).trim();
  return { front, back: splitAnswers(backPart), example, cloze, hasBack: at !== -1 };
}

// What goes into a second step's field: the back of a card, maybe with its example ("cat; kitty // …")
export function parseBack(text) {
  const { back, example } = parseLine(`x = ${text}`);
  return { back, example };
}

// A card as one line, for fixing it: the reverse of parseLine. A backslash is doubled where it would
// otherwise read as an escape (before = ; // {{ \ or at the end of a piece).
const backslashes = (text, { cloze = false } = {}) => text.replace(cloze ? /\\(?=[=;\\]|\/\/|$)/g : /\\(?=[=;\\]|\/\/|\{\{|$)/g, "\\\\");
export function formatLine({ front, back = [], example = "", cloze = false }) {
  let line = backslashes(front, { cloze }).replace(/ =/g, " \\=");
  if (!cloze) line = line.replace(/\{\{/g, "\\{{");
  const backText = back.map((answer) => backslashes(answer).replace(/;/g, "\\;").replace(/(^|\s)\/\//g, "$1\\//")).join("; ");
  if (backText || example) line += ` = ${backText}`;
  if (example) line += ` // ${backslashes(example)}`;
  return line;
}
