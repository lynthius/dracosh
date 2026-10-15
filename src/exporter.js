import { t } from "./i18n.js";
import { formatLine, GAP } from "./cardline.js";
import { cardsOf } from "./library.js";

// Decks written out as text, picked by the file's extension:
//   .txt  Dracosh lines, as /add takes them, with "#deck:" and "#direction:" above each deck: easy to
//         read and edit (by you or an AI assistant), and `dracosh import` reads it back unchanged
//   .tsv  for Anki: File → Import takes it as it is (tab-separated, with Anki's header lines)
//   .csv  for spreadsheets: front, back, example (and deck, when there are several)
// A full backup (.json) is backup.js's job. Each function takes the decks to write and the library.

export const EXPORT_FORMATS = ["txt", "tsv", "csv", "json"];

// a line starting with "#" would read as a comment: "\#" keeps it a card (and "\\#" a "\#" front)
const keepHash = (line) => (/^\\*#/.test(line) ? `\\${line}` : line);

export function toDracoshText(library, decks, { now = Date.now() } = {}) {
  const parts = [`# ${t("export.fileHeader", { date: new Date(now).toISOString().slice(0, 10) })}`, `# ${t("export.fileHowTo")}`];
  for (const deck of decks) {
    parts.push("", `#deck:${deck.name}`, `#direction:${deck.directions}`);
    for (const card of cardsOf(library, deck.id)) parts.push(keepHash(formatLine(card)));
  }
  return `${parts.join("\n")}\n`;
}

// RFC 4180: a cell with the separator, a quote, a line break or a leading "#" goes in quotes
const cell = (value, separator) => {
  const text = String(value ?? "");
  return text.includes(separator) || /["\r\n]/.test(text) || text.startsWith("#") || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
};
const row = (cells, separator) => cells.map((value) => cell(value, separator)).join(separator);

export function toCsv(library, decks) {
  const several = decks.length > 1;
  const lines = [row([...(several ? ["deck"] : []), "front", "back", "example"], ",")];
  for (const deck of decks) {
    for (const card of cardsOf(library, deck.id)) lines.push(row([...(several ? [deck.name] : []), textFront(card), joinAnswers(card.back), card.example ?? ""], ","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// braces in a card without gaps are text: "\{{" keeps them from reading as a gap again
const textFront = (card) => (card.cloze ? card.front : card.front.replace(/\{\{/g, "\\{{"));

// answers joined by ";" as in /add: one holding a ";" keeps it as "\;"
const joinAnswers = (back) => back.map((answer) => answer.replace(/;/g, "\\;")).join("; ");

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Anki's "Basic" note has two fields, so the example goes under the answers, on a line of its own.
// A cloze card becomes Anki's "Cloze" note ("{{c1::…}}"), its back the "Back Extra" field.
export function toAnki(library, decks) {
  const cards = decks.flatMap((deck) => cardsOf(library, deck.id).map((card) => ({ deck, card })));
  const cloze = cards.some(({ card }) => card.cloze);
  const several = decks.length > 1;
  const header = ["#separator:tab", "#html:true"];
  if (cloze) header.push("#notetype column:1");
  else header.push("#notetype:Basic");
  if (several) header.push(`#deck column:${cloze ? 2 : 1}`);
  else header.push(`#deck:${decks[0]?.name ?? ""}`);
  const lines = cards.map(({ deck, card }) => {
    let gap = 0;
    // the same gaps as the quiz asks (GAP); braces kept as text ("\{{") are plain text in Anki too
    const front = card.cloze ? escapeHtml(card.front.replace(GAP, (_, text) => `{{c${++gap}::${text}}}`).replace(/\\\{\{/g, "{{")) : escapeHtml(card.front);
    const back = [escapeHtml(joinAnswers(card.back)), card.example ? escapeHtml(card.example) : ""].filter(Boolean).join("<br>");
    return row([...(cloze ? [card.cloze ? "Cloze" : "Basic"] : []), ...(several ? [deck.name] : []), front, back], "\t");
  });
  return `${[...header, ...lines].join("\n")}\n`;
}
