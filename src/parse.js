const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

const decode = (s) => s.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

// block-level closers and <br> become line breaks, every other tag disappears
function htmlToLines(html) {
  return decode(
    html
      .replace(/<br\s*\/?>|<\/(?:div|p|span)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const unquote = (s) => s.replace(/^["“”]+|["“”]+$/g, "").trim();

// "define" cards (uppercase domain tag + English definition) have no translation to quiz on
const isDefineCard = (backHtml) => /text-transform:\s*uppercase/i.test(backHtml);

// → { noteId, word, translations[], example } or null when the card isn't a translation card
export function parseNote({ noteId, front, back }) {
  if (isDefineCard(back)) return null;
  const word = htmlToLines(front).join(" ");
  const [first, ...rest] = htmlToLines(back);
  if (!word || !first) return null;
  const translations = first.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  if (!translations.length) return null;
  return { noteId, word, translations, example: rest.length ? unquote(rest.join(" ")) : "" };
}

export function parseNotes(notes) {
  const words = [];
  let skipped = 0;
  for (const note of notes) {
    const parsed = parseNote(note);
    if (parsed) words.push(parsed);
    else skipped += 1;
  }
  return { words, skipped };
}
