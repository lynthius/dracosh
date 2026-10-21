import { decodeEntities } from "./entities.js";
import { gapsOf, parseLine } from "./cardline.js";
import { normalize } from "./judge.js";

// A list of cards read from text: a file being imported, or a list pasted into /add. It's either
// Dracosh lines (the /add format, "el gato = the cat; kitty // example"), a table (Anki's and
// Quizlet's tab-separated exports, a spreadsheet's CSV, rows copied from Sheets or Excel), or a plain
// list written with dashes ("apple - jabłko"). Nothing is guessed silently: what was taken how is
// returned (`format`, `columns`, `ignored`), so it can be shown before anything is saved.
//
// A file can start with "#key:value" lines. Anki's are read (#separator, #html, #columns, #deck,
// and the #… column ones), and two of Dracosh's own: #deck can come again further down to start the
// next deck, and #direction says how a new deck is asked (forward, backward or both). Any other line
// starting with "#" is a comment.

const NAMED_SEPARATORS = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", colon: ":", space: " " };
const TABLE_SEPARATORS = ["\t", ",", ";", "|"];
const DASHES = [" - ", " – ", " — "];
export const DIRECTION_HEADERS = { forward: "forward", backward: "backward", both: "both" };

// "#separator:Tab" → "\t"; a single character stands for itself
export function separatorNamed(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  const named = NAMED_SEPARATORS[text.trim().toLowerCase()];
  if (named) return named;
  return Array.from(text).length === 1 ? text : null;
}

const looksLikeHtml = (text) => /<\/?(br|div|p|span|b|i|u|strong|em|font|ul|ol|li|img|sup|sub|a)\b[^>]*>|&(nbsp|amp|lt|gt|quot);/i.test(text);

// a field from Anki, maybe HTML: its lines, without tags (sounds and images are left out, and so
// are styles, scripts and a ruby's reading: <ruby>漢字<rt>かんじ</rt></ruby> is 漢字)
export function htmlLines(html) {
  return decodeEntities(
    String(html)
      .replace(/\[sound:[^\]]*\]/g, "")
      .replace(/<(style|script|rt|rp)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>|<\/?(div|p|li|tr)\b[^>]*>/gi, "\n")
      .replace(/<\/(td|th)\s*>/gi, " ")
      .replace(/<[^>]*>/g, "")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Anki's cloze "{{c1::look forward::hint}}" is a Dracosh gap "{{look forward}}"; other braces in an
// Anki cloze note are plain text there, so they stay text ("\{{")
const ANKI_GAP = /\{\{c\d+::(.*?)(?:::[^{}]*?)?\}\}/g;
const INNERMOST_GAP = /\{\{c\d+::([^{}]*?)(?:::[^{}]*?)?\}\}/g;
const [OPEN, CLOSE, LITERAL] = ["\u000e", "\u000f", "\u0010"];
// `anki`: the text comes from an Anki file, where only "{{c1::…}}" is a gap. Anki nests gaps
// ("{{c1::a {{c2::b}} c}}") and Dracosh doesn't: the outer gap stays, the inner ones are its text.
const fromAnkiCloze = (text, anki = false) => {
  if (!new RegExp(ANKI_GAP.source).test(text)) return anki ? text.replace(/(?<!\\)\{\{/g, "\\{{") : text;
  let marked = text.replace(/\{\{(?!c\d+::)/g, LITERAL);
  for (let before = ""; before !== marked; ) [before, marked] = [marked, marked.replace(INNERMOST_GAP, `${OPEN}$1${CLOSE}`)];
  let depth = 0;
  let result = "";
  for (const char of marked) {
    if (char === OPEN) result += depth++ ? "" : "{{";
    else if (char === CLOSE) result += --depth ? "" : "}}";
    else result += char;
  }
  return result.replaceAll(LITERAL, "\\{{");
};
// "{{c1::come::verb}}": Anki's hints, shown in place of the gap. Dracosh has one hint per card
const gapHints = (text) => [...new Set([...text.matchAll(/\{\{c\d+::[^{}]*?::([^{}]*?)\}\}/g)].map((match) => match[1].trim()).filter(Boolean))].join(", ");
// A package from Dracosh writes braces that aren't a gap as "&#123;{" and "::" in a gap as ":&#58;":
// the same to see in Anki, never read as cloze. They're kept apart until the gaps are found.
const [BRACE, COLON] = ["\u0011", "\u0012"];
const hideEntities = (html) => String(html).replace(/&#123;|&#x7b;|&lbrace;/gi, BRACE).replace(/&#58;|&#x3a;|&colon;/gi, COLON);
const showEntities = (text) => text.replace(new RegExp(`${BRACE}\\{`, "g"), "\\{{").replaceAll(BRACE, "{").replaceAll(COLON, ":");

// One Anki note (from a package) → card fields, from its fields' HTML by role. `cloze`: the note
// type is a cloze one (only then is "{{c1::…}}" a gap; elsewhere braces are text). A cloze note's
// second field is Anki's Extra, shown after the answer, so it's an example; `hint: true` (Dracosh
// Cloze) says it's a hint shown with the gap instead. `perLine: true` (Dracosh): one answer a line.
export function noteFields({ front = "", back = "", example = "", cloze = false, hint = false, perLine = false }) {
  const written = htmlLines(front).join(" ");
  const backLines = htmlLines(back);
  const extra = htmlLines(example);
  const text = cloze ? showEntities(fromAnkiCloze(htmlLines(hideEntities(front)).join(" "), true)) : written;
  if (cloze && gapsOf(text).length) {
    const hintText = hint ? backLines.join(" ") : gapHints(written);
    return { front: text, back: [hintText].filter(Boolean), example: [...(hint ? [] : backLines), ...extra].join(" "), cloze: true, hasBack: true };
  }
  if (perLine) return { front: written, back: backLines, example: extra.join(" "), cloze: false, hasBack: backLines.length > 0 };
  const [answers = "", ...more] = backLines;
  return { front: written, back: splitAnswers(answers), example: [...more, ...extra].join(" "), cloze: false, hasBack: Boolean(answers) };
}

// The header lines at the top ("#key:value"); the rest is the body, its line numbers kept
function readHeader(lines) {
  const header = {};
  let at = 0;
  for (; at < lines.length; at++) {
    const match = /^#([a-z ]+):(.*)$/i.exec(lines[at]);
    if (!match) break;
    header[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return { header, body: at };
}

// A cell opening with a quote is a quoted one only when its closing quote ends the cell: '"to be" or
// not' and an unmatched '"Quote me' are plain text that happens to start with a quote
function closesCell(text, open, separator) {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (text[i + 1] === '"') {
      i++;
      continue;
    }
    const next = text.slice(i + 1).match(/^[ ]*(.|\n|$)/)[1];
    return next === separator || next === "\n" || next === "";
  }
  return false;
}

// Rows split on a one-character separator, the way spreadsheets write them: a cell in double quotes
// can hold the separator and line breaks, and "" inside it is one quote. → [{ line, cells, comment }]:
// `line` is the 1-based line the row starts on; `comment`: the row starts with "#" (with `comments`:
// then it's the whole line, quotes and all). Empty rows are left out.
export function splitRows(lines, separator, firstLine = 1, { comments = true } = {}) {
  const text = lines.join("\n");
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let line = firstLine;
  let rowLine = firstLine;
  let cellStart = true;
  let comment = false;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim())) rows.push({ line: rowLine, cells, comment });
    cells = [];
    cell = "";
    cellStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (cells.length === 0 && cell === "") {
      comment = comments && ch === "#";
      if (comment) {
        const end = text.indexOf("\n", i);
        cell = text.slice(i, end === -1 ? text.length : end);
        i = (end === -1 ? text.length : end) - 1;
        continue;
      }
    }
    if (ch === '"' && cellStart && cell.trim() === "" && closesCell(text, i, separator)) {
      quoted = true;
      cell = "";
      cellStart = false;
    } else if (ch === separator) {
      cells.push(cell);
      cell = "";
      cellStart = true;
    } else if (ch === "\n") {
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
      if (ch !== " ") cellStart = false;
    }
  }
  if (cell !== "" || cells.length) endRow();
  return rows;
}

// How well a separator splits these lines into a table: the share of rows with the most common
// number of cells, when that number is 2 or more (0 otherwise)
function tableScore(lines, separator) {
  const rows = splitRows(lines.slice(0, 200), separator, 1, { comments: false });
  if (rows.length === 0) return { score: 0, columns: 0 };
  const counts = new Map();
  for (const row of rows) {
    const filled = trimEmpty(row.cells).length;
    counts.set(filled, (counts.get(filled) ?? 0) + 1);
  }
  const [columns, often] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return { score: columns >= 2 ? often / rows.length : 0, columns };
}

// trailing empty cells don't count: spreadsheets often write a few
function trimEmpty(cells) {
  let end = cells.length;
  while (end > 0 && !cells[end - 1].trim()) end--;
  return cells.slice(0, end);
}

// A header row names its columns ("front,back,example", "term;definition"); it isn't a card
const COLUMN_NAMES = {
  front: ["front", "term", "word", "question", "prompt", "expression", "vocabulary", "text", "przód", "termin", "słowo", "pytanie", "vorderseite", "begriff", "wort", "frage", "recto", "terme", "mot", "лицьова", "термін", "слово"],
  back: ["back", "definition", "translation", "answer", "meaning", "tył", "definicja", "tłumaczenie", "odpowiedź", "znaczenie", "rückseite", "definition", "übersetzung", "antwort", "bedeutung", "verso", "traduction", "réponse", "sens", "зворотна", "визначення", "переклад", "відповідь", "значення"],
  example: ["example", "sentence", "context", "notes", "note", "przykład", "zdanie", "notatka", "beispiel", "satz", "exemple", "phrase", "приклад", "речення"],
  deck: ["deck", "talia", "stapel", "paquet", "колода"],
  skip: ["tags", "tag", "guid", "id", "notetype", "note type", "tagi", "schlagwörter", "étiquettes", "теги"]
};
export const columnRole = (name) => {
  const key = normalize(name);
  return Object.entries(COLUMN_NAMES).find(([, names]) => names.some((n) => normalize(n) === key))?.[0] ?? null;
};
// it names both a front and a back column: "Wort,word" is a card, "Wort,Übersetzung" a header
const isHeaderRow = (cells) => {
  const roles = cells.map((cell) => columnRole(cell.replace(/^"|"$/g, "")));
  return roles.includes("front") && roles.includes("back");
};

// → { front, back, example, deck, skip: Set } column indexes, from a header row or Anki's headers;
// without names: front, back, example in that order
function columnsFrom(names, header = {}) {
  const roles = { front: null, back: null, example: null, deck: null, notetype: null, skip: new Set() };
  const at = (value) => (/^\d+$/.test(String(value ?? "").trim()) ? Number(value) - 1 : null);
  for (const key of ["guid column", "notetype column", "tags column"]) if (at(header[key]) !== null) roles.skip.add(at(header[key]));
  roles.notetype = at(header["notetype column"]);
  if (at(header["deck column"]) !== null) roles.deck = at(header["deck column"]);
  if (names) {
    names.forEach((name, i) => {
      const role = columnRole(name);
      if (role === "skip") roles.skip.add(i);
      else if (role && roles[role] === null && !roles.skip.has(i)) roles[role] = i;
    });
  }
  // the fields left over, in order: front, back, then an example
  let next = 0;
  const free = () => {
    while (next === roles.deck || roles.skip.has(next) || [roles.front, roles.back, roles.example].includes(next)) next++;
    return next++;
  };
  if (roles.front === null) roles.front = free();
  if (roles.back === null) roles.back = free();
  if (roles.example === null && !names) roles.example = free();
  return roles;
}

// "\;" keeps a semicolon inside an answer, as in /add
const splitAnswers = (text) => text.split(/(?<!\\);/).map((part) => part.replace(/\\;/g, ";").trim()).filter(Boolean);

// One table row → card fields. A line break in the back starts the example (Anki notes are often
// "answer<br>example sentence"); answers are separated by ";" as in /add.
function rowFields(cells, roles, html, anki = false) {
  const cell = (i) => (i === null || i === undefined ? "" : cells[i] ?? "");
  const lines = (text) => (html || looksLikeHtml(text) ? htmlLines(text) : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const written = lines(cell(roles.front)).join(" ");
  // in an Anki note without "{{c1::…}}" braces are plain text. The note type's name can't tell: Anki
  // names it in its own language ("Cloze" is "Luka", "Lückentext"…)
  const plainNote = roles.notetype !== null && roles.notetype !== undefined && !new RegExp(ANKI_GAP.source).test(written);
  const front = plainNote ? written.replace(/(?<!\\)\{\{/g, "\\{{") : fromAnkiCloze(written, anki);
  const cloze = gapsOf(front).length > 0;
  let [answers = "", ...more] = lines(cell(roles.back));
  // a cloze note's Extra field is shown after the answer, so on its own it's an example, not a hint
  if (anki && cloze && !more.length && !cell(roles.example)) [answers, more] = ["", [answers].filter(Boolean)];
  const example = [...more, ...lines(cell(roles.example))].join(" ");
  // a cloze card's back is one hint, as in /add
  const back = cloze ? [answers.replace(/\\;/g, ";").trim() || (anki ? gapHints(written) : "")].filter(Boolean) : splitAnswers(answers);
  // a card without gaps keeps its braces as they are ("\{{x}}" was only there to say they're text)
  return { front: cloze ? front : front.replace(/\\\{\{/g, "{{"), back, example, cloze, hasBack: Boolean(answers) || cloze };
}

// A dash list's line splits on its first dash; a tab still splits a line that has one
const dashOf = (line) => DASHES.map((dash) => [dash, line.indexOf(dash)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1])[0]?.[0];

// What kind of list this is, when the header doesn't say: a table when one separator splits nearly
// every row the same way (a ".csv" file is always one), Dracosh lines when they use " = ", a dash
// list when most lines have a dash
function detectFormat(lines, { csv = false, comments = true } = {}) {
  const content = lines.filter((line) => line.trim() && !(comments && line.startsWith("#")));
  const share = (test) => (content.length ? content.filter(test).length / content.length : 0);
  const equals = share((line) => line.includes(" = "));
  // a header row ("front,back", "term\tdefinition") says which separator it is
  const named = TABLE_SEPARATORS.find((separator) => {
    const cells = trimEmpty(content[0]?.split(separator) ?? []);
    return cells.length >= 2 && isHeaderRow(cells);
  });
  if (named) return { format: "table", separator: named };
  if (share((line) => line.includes("\t")) >= Math.max(0.8, equals)) return { format: "table", separator: "\t" };
  if (!csv && equals >= 0.5) return { format: "lines" };
  if (!csv && share((line) => dashOf(line)) >= 0.5) return { format: "dashes" };
  // commas and semicolons in sentences ("Yes, I do") come with a space after them; a spreadsheet's don't
  const prose = (separator) => share((line) => line.includes(`${separator} `)) >= 0.5;
  const best = TABLE_SEPARATORS.filter((separator) => csv || !prose(separator))
    .map((separator) => ({ separator, ...tableScore(content, separator) }))
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= (csv ? 0.5 : 0.9) && content.length >= (csv ? 1 : 2)) return { format: "table", separator: best.separator };
  return csv ? { format: "table", separator: "," } : { format: "lines" };
}

// → { format, separator, header, items: [{ line, deck, direction, source, fields }], columns, ignored,
// unknown, anki, html }: `unknown` lists "#direction:" lines that name no direction, `anki` says the
// file has Anki's header lines, `html` that its fields are HTML
// `line`: where the card starts in the text (1-based); `source`: its text as written (for a fix);
// `deck` and `direction`: from the "#deck:" and "#direction:" lines above it, if any;
// `ignored`: the lines with text in a column that isn't read (shown, never dropped silently).
// `separator` (a name or a character) and `csv` (the file is a .csv) are hints from the caller.
// `comments: false` (a list pasted into /add) reads every line as a card: no header, no "#" lines.
export function readCardList(text, { separator: forced = null, csv = false, comments = true } = {}) {
  const all = String(text ?? "").replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const { header, body } = comments ? readHeader(all) : { header: {}, body: 0 };
  // a bulleted list ("- dom - house", "• dom = house") loses its bullets
  const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
  const filled = all.slice(body).filter((line) => line.trim());
  const bulleted = filled.length > 0 && filled.filter((line) => BULLET.test(line)).length * 2 >= filled.length;
  const lines = all.slice(body).map((line) => (bulleted ? line.replace(BULLET, "") : line));
  const html = /^true$/i.test(header.html ?? "");
  const anki = ["separator", "html", "notetype", "notetype column", "guid column"].some((key) => key in header);
  const fromHeader = separatorNamed(forced ?? header.separator);
  const detected = fromHeader ? { format: "table", separator: fromHeader } : detectFormat(lines, { csv, comments });
  const direction = (value) => DIRECTION_HEADERS[String(value ?? "").trim().toLowerCase()] ?? null;
  let deck = header.deck || null;
  // a "#direction:" that isn't one is said, not ignored
  const unknown = [];
  const readDirection = (value, line) => {
    const read = direction(value);
    if (!read && String(value).trim()) unknown.push({ line, text: `#direction:${String(value).trim()}` });
    return read;
  };
  let deckDirection = header.direction === undefined ? null : readDirection(header.direction, body);
  const items = [];
  const ignored = []; // the lines with text in a column that isn't read
  let columns = null;

  if (detected.format === "table") {
    // "#deck:" and "#direction:" rows switch the deck; other "#" rows are comments
    const rows = [];
    for (const row of splitRows(lines, detected.separator, body + 1, { comments })) {
      if (!row.comment) rows.push(row);
      else rows.push({ ...row, marker: lines[row.line - body - 1].trim() });
    }
    const named = header.columns ? header.columns.split(detected.separator === "\t" ? "\t" : detected.separator).map((name) => name.trim()) : null;
    const first = rows.find((row) => !row.marker) && trimEmpty(rows.find((row) => !row.marker).cells);
    const headerRow = !named && first && first.length >= 2 && isHeaderRow(first);
    const roles = columnsFrom(named ?? (headerRow ? first : null), header);
    // only the columns there are: a two-column list has no example column
    const width = Math.max(0, ...rows.filter((row) => !row.marker).map((row) => trimEmpty(row.cells).length));
    columns = Object.fromEntries(["deck", "front", "back", "example"].map((role) => [role, roles[role] !== null && roles[role] < width ? roles[role] : null]));
    const firstCard = headerRow ? rows.find((row) => !row.marker) : null;
    for (const row of rows) {
      if (row === firstCard) continue;
      if (row.marker) {
        if (/^#deck:/i.test(row.marker)) [deck, deckDirection] = [row.marker.slice(6).trim() || null, null];
        else if (/^#direction:/i.test(row.marker)) deckDirection = readDirection(row.marker.slice(11), row.line);
        continue;
      }
      const used = new Set([roles.front, roles.back, roles.example, roles.deck, ...roles.skip]);
      if (row.cells.some((cell, i) => !used.has(i) && cell.trim())) ignored.push(row.line);
      // a row without the separator: maybe a Dracosh line among the rows
      const fields = row.cells.length === 1 && row.cells[0].includes(" = ") ? parseLine(row.cells[0]) : rowFields(row.cells, roles, html, anki);
      const rowDeck = roles.deck !== null && row.cells[roles.deck]?.trim() ? row.cells[roles.deck].trim() : deck;
      items.push({ line: row.line, deck: rowDeck, direction: deckDirection, source: row.cells.join(detected.separator === "\t" ? "\t" : detected.separator), fields });
    }
  } else {
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (comments && /^#deck:/i.test(line)) return void ([deck, deckDirection] = [line.slice(6).trim() || null, null]);
      if (comments && /^#direction:/i.test(line)) return void (deckDirection = readDirection(line.slice(11), body + i + 1));
      if (comments && line.startsWith("#")) return; // a comment ("\#" starts a card with "#")
      // a line with a tab is a row copied from a table: front, back, example
      const card = comments && line.startsWith("\\#") ? line.slice(1) : line;
      const fields = card.includes("\t") ? rowFields(card.split("\t"), { front: 0, back: 1, example: 2 }, false) : parseLine(card, { separator: detected.format === "dashes" ? (dashOf(card) ?? " = ") : " = " });
      items.push({ line: body + i + 1, deck, direction: deckDirection, source: line, fields });
    });
  }
  return { format: detected.format, separator: detected.separator ?? null, header, items, columns, ignored, unknown, anki, html };
}
