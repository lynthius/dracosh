import { t } from "./i18n.js";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { backupData, backupNow, restoreBackup } from "./backup.js";
import { plainFront } from "./cardline.js";
import { readCardList, separatorNamed } from "./cardlist.js";
import { applyImport, decodeText, markFromAnki, planCounts, planImport } from "./importer.js";
import { NOTE_TYPE_FIELDS, readApkg, toApkg } from "./apkg.js";
import { ankiDecks, connect, exportDeck, importIntoAnki, noteType } from "./ankiconnect.js";
import { loadSqlite } from "./sqlite.js";
import { EXPORT_FORMATS, toAnki, toCsv, toDracoshText } from "./exporter.js";
import { deckLanguages, isKnown, languageName } from "./language.js";
import { cardsOf, findDeck, MAX_DECK_NAME } from "./library.js";
import { ALREADY_RUNNING, runningPid } from "./lock.js";
import { checkState, damaged, DATA_FILES, HOME, loadLibrary, loadState, readJson, saveLibrary, saveState } from "./store.js";
import { upgradeLibrary } from "./library.js";
import { missingDeck } from "./words.js";

// `dracosh import` and `dracosh export`. An import always shows what it will do and asks first (in a
// terminal; elsewhere --yes says go), takes a backup before writing, and says how to undo it.

const SHOWN = 8; // problems or changed cards listed before "… and N more"
const MAX_FILE = 20e6; // a deck of a few hundred thousand cards; anything bigger is likely not one

// UTF-16 without a BOM: every other byte is zero
const looksUtf16 = (bytes) => {
  const sample = bytes.subarray(0, 4000);
  const zeros = (offset) => sample.filter((byte, i) => i % 2 === offset && byte === 0).length;
  return sample.length >= 4 && Math.max(zeros(0), zeros(1)) > sample.length * 0.3 && Math.min(zeros(0), zeros(1)) === 0;
};
const out = (text = "") => console.log(text);

// Ctrl+C or Ctrl+D at a question stops here, before anything is written
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } catch {
    out();
    throw new Error(t("cli.restore.nothingChanged"));
  } finally {
    rl.close();
  }
}

// A yes or no question: Enter takes the default, anything that's neither is asked again
async function confirm(question, byDefault) {
  const words = (key) => t(key).split("|");
  for (;;) {
    const answer = (await ask(`${question} ${byDefault ? t("import.askSuffix") : t("cli.restore.askSuffix")} `)).toLowerCase();
    if (!answer) return byDefault;
    if (words("cli.restore.yes").includes(answer)) return true;
    if (words("import.no").includes(answer)) return false;
  }
}
const answers = (back) => back.join("; ");
// a cloze card keeps its {{gaps}} in the preview, so you see what will be asked
// a cloze card's back is a hint, not an answer: "Ella {{come}} pan.  (hint: verb)"
const cardText = (fields) => (!fields.back.length ? fields.front : fields.cloze ? `${fields.front}  ${t("import.hint", { hint: fields.back[0] })}` : `${fields.front} = ${answers(fields.back)}`);
const cut = (text, max = 60) => (Array.from(text).length > max ? `${Array.from(text).slice(0, max - 1).join("")}…` : text);
const more = (count) => count > 0 && out(`  ${t("import.more", { count })}`);

// a file's name without its extension, as a deck name: "spanish-verbs.csv" → "spanish-verbs"
const deckFromFile = (file) => Array.from(basename(file, extname(file)).trim()).slice(0, MAX_DECK_NAME).join("");

const SEPARATOR_NAMES = { "\t": "tab", ",": "comma", ";": "semicolon", "|": "pipe", ":": "colon", " ": "space" };
function describeRead(read) {
  if (read.format !== "table") return t(`import.formats.${read.format}`);
  const separator = SEPARATOR_NAMES[read.separator] ? t(`import.separators.${SEPARATOR_NAMES[read.separator]}`) : `"${read.separator}"`;
  const roles = ["deck", "front", "back", "example"].filter((role) => read.columns?.[role] !== null && read.columns?.[role] !== undefined);
  const columns = roles.map((role) => t("import.column", { number: read.columns[role] + 1, role: t(`import.roles.${role}`) })).join(", ");
  return t("import.formats.table", { separator, columns });
}

// `notes`: the cards came from an Anki package, so a place in it is a note's number, not a line
function issueText(problem, notes) {
  if (problem.issue === "twice") return t(notes ? "import.issues.twiceNote" : "import.issues.twice", { line: problem.first });
  if (problem.issue === "tooLong") return t("import.issues.tooLong", { max: MAX_DECK_NAME, deck: cut(problem.deck, 30) });
  if (problem.issue === "tour") return t("import.issues.tour", { deck: problem.deck });
  return t(`import.issues.${problem.issue}`);
}

const readError = (err, file) => {
  const why = { ENOENT: "import.noFile", EISDIR: "import.isFolder", EACCES: "import.noPermission", EPERM: "import.noPermission", TOO_BIG: "import.tooBig" }[err.code];
  return new Error(why ? t(why, { file, max: MAX_FILE / 1e6 }) : t("errors.cantRead", { file, error: err.message }));
};

// Anki's own packages need what Node has from 22.15 on (sqlite.js)
const needsNode = (err, key) => (err.code === "NEEDS_NODE" ? new Error(t(key, { version: err.version, current: process.versions.node })) : err);

// an Anki package (.apkg, .colpkg): read whole, however big its media (only the collection is unpacked)
async function readPackage(file) {
  try {
    if (!(await stat(file)).isFile()) throw Object.assign(new Error(), { code: "EISDIR" });
    return await readApkg(file);
  } catch (err) {
    if (err.code === "NOT_ANKI") throw new Error(t("import.notAnki", { file }));
    if (err.code === "NEEDS_NODE") throw needsNode(err, "import.needsNode");
    throw ["ENOENT", "EISDIR", "EACCES", "EPERM"].includes(err.code) ? readError(err, file) : err;
  }
}

async function readInput(file, encoding) {
  let bytes;
  if (file === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    bytes = Buffer.concat(chunks);
  } else {
    try {
      if ((await stat(file)).size > MAX_FILE) throw Object.assign(new Error(), { code: "TOO_BIG" });
      bytes = await readFile(file);
    } catch (err) {
      throw readError(err, file);
    }
  }
  const name = file === "-" ? t("import.stdin") : file;
  // a picture or a zip has zero bytes where text never does (UTF-16 is read before this)
  const bom16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!bom16 && !looksUtf16(bytes) && bytes.subarray(0, 8000).includes(0)) throw new Error(t("import.notText", { file: name }));
  try {
    return decodeText(bytes, encoding);
  } catch (err) {
    if (!err.samples) throw err;
    const lines = err.samples.map((sample) => `  --encoding ${sample.encoding}   ${sample.line}`);
    throw new Error([t("import.notUtf8", { file: name }), ...lines, t("import.notUtf8Hint")].join("\n"));
  }
}

// a full backup made by `dracosh export x.json`: brought back like `dracosh restore`, once each of its
// files is known to be one Dracosh can use (nothing is written otherwise)
async function importBackup(file, { yes: sure }) {
  const running = runningPid();
  if (running) throw new Error(ALREADY_RUNNING(running));
  const backup = await readJson(file, null);
  if (!backup) throw new Error(t("import.noFile", { file }));
  if (backup.format !== 1 || !backup.files || typeof backup.files !== "object") throw new Error(t("errors.notABackup", { file }));
  const { library, state, settings } = backup.files;
  if (library !== undefined) {
    try {
      upgradeLibrary(library);
    } catch (err) {
      throw err.damaged ? damaged(file, err.message) : err;
    }
  }
  if (state !== undefined) checkState(state, file);
  if (settings !== undefined && (settings === null || typeof settings !== "object" || Array.isArray(settings))) throw damaged(file, t("errors.why.notLibrary"));
  out(t("import.backupFile", { file }));
  const now = await loadLibrary().catch(() => null);
  if (now?.decks.some((deck) => !deck.tour)) out(t("import.backupReplaces", { decks: t("count.decks", { count: now.decks.filter((d) => !d.tour).length }), cards: t("count.cards", { count: now.cards.length }) }));
  out(`  ${t("cli.restore.row", { decks: t("count.decks", { count: library?.decks?.length ?? 0 }), cards: t("count.cards", { count: library?.cards?.length ?? 0 }), practised: Object.keys(state?.items ?? {}).length })}`);
  if (Object.values(DATA_FILES).some((data) => existsSync(data))) out(t("cli.restore.undo"));
  if (!sure) {
    if (!process.stdin.isTTY) return out(t("cli.restore.needsYes"));
    if (!(await confirm(t("import.backupAsk"), false))) return out(t("cli.restore.nothingChanged"));
  }
  await restoreBackup(file);
  out(t("cli.restore.done"));
}

// a word for the shell, as typed: quoted when it needs to be ("Spanish verbs", it's, $5)
const shellQuote = (word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

// Anki's add-on said no, or nobody answered → what to do about it
function ankiError(err) {
  if (err.code === "NEEDS_NODE") return needsNode(err, "import.needsNode");
  const key = { NO_ANKI: "anki.notRunning", ANKI_BUSY: "anki.busy", BAD_URL: "anki.badUrl", OLD_ANKICONNECT: "anki.old", ANKI_KEY: "anki.key", NO_DECK: "anki.noDeck", NOT_IMPORTED: "anki.notImported", ANKI_ERROR: "anki.said" }[err.code];
  return key ? new Error(t(key, { detail: err.detail })) : err;
}

// `dracosh import --anki ["Deck"]`: decks copied from a running Anki, as packages Anki writes itself
// and read like an .apkg. Without a deck, a terminal asks which; otherwise it's all of them.
// → the card list, and which decks it came from
async function readFromAnki(deckName, { interactive, yes }) {
  const folder = mkdtempSync(join(tmpdir(), "dracosh-anki-"));
  try {
    await loadSqlite(); // what reading Anki's packages needs, before Anki is asked for any
    const anki = connect();
    const all = await ankiDecks(anki);
    const decks = all.filter((deck) => deck.notes > 0 && !deck.filtered);
    if (!decks.length) throw new Error(t("import.anki.empty"));
    let chosen;
    if (deckName) {
      const deck = decks.find((each) => each.name.toLowerCase() === deckName.trim().toLowerCase());
      if (!deck) throw new Error(t("import.anki.noDeck", { deck: deckName, decks: decks.map((each) => each.name).join(", ") }));
      chosen = [deck.name];
    } else if (interactive && !yes) {
      out(t("import.anki.yourDecks"));
      decks.forEach((deck, i) => out(`  ${i + 1}. ${deck.name} (${t("count.cards", { count: deck.notes })})`));
      for (;;) {
        const answer = await ask(t("import.anki.which"));
        if (/^q(uit)?$/i.test(answer)) throw new Error(t("cli.restore.nothingChanged"));
        const numbers = answer.split(/[\s,]+/).filter(Boolean).map(Number);
        if (!numbers.length) chosen = decks.map((deck) => deck.name);
        else if (numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= decks.length)) chosen = numbers.map((n) => decks[n - 1].name);
        if (chosen) break;
      }
    } else chosen = decks.map((deck) => deck.name);
    // a deck comes with its subdecks, so a subdeck of one already chosen isn't asked for again
    chosen = [...new Set(chosen)].filter((name) => !chosen.some((other) => name.startsWith(`${other}::`)));
    const list = { format: "apkg", separator: null, header: {}, items: [], columns: null, ignored: [], unknown: [], anki: true, html: true, media: 0 };
    const inChosen = (deck) => chosen.some((name) => deck === name || deck?.startsWith(`${name}::`));
    // a deck's export leaves out its cards lent to a filtered deck: those come from the filtered one
    // (one inside a chosen deck comes with it); and a filtered deck inside a chosen one may hold
    // other decks' cards, which stay out
    const lending = all.filter((deck) => deck.filtered && deck.notes > 0 && !inChosen(deck.name)).map((deck) => deck.name);
    for (const [i, name] of [...chosen, ...lending].entries()) {
      if (i < chosen.length) out(t("import.anki.asking", { deck: name }));
      const path = join(folder, `${i}.apkg`);
      await exportDeck(anki, name, path);
      const part = await readApkg(path);
      const items = part.items.filter((item) => inChosen(item.deck));
      list.items.push(...items.map((item, j) => ({ ...item, line: list.items.length + j + 1 })));
      if (i < chosen.length) list.media += part.media;
    }
    return { list, decks: chosen };
  } catch (err) {
    throw ankiError(err);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export async function runImport(file, options) {
  const viaAnki = Boolean(options.anki);
  if (!file && !viaAnki) throw new Error(t("import.needFile"));
  const ending = viaAnki || file === "-" ? "" : extname(file).toLowerCase();
  if (ending === ".json") return importBackup(file, options);
  const isPackage = viaAnki || ending === ".apkg" || ending === ".colpkg";
  if (isPackage && (options.separator !== undefined || options.encoding !== undefined)) throw new Error(t("import.notForPackage"));
  const interactive = process.stdin.isTTY && file !== "-";
  if (options.separator !== undefined && !separatorNamed(options.separator)) throw new Error(t("import.badSeparator", { value: options.separator }));
  const anki = viaAnki ? await readFromAnki(file, { interactive, yes: options.yes }) : null;
  const { text, encoding, list } = anki ? { text: null, encoding: "utf-8", list: anki.list } : isPackage ? { text: null, encoding: "utf-8", list: await readPackage(file) } : await readInput(file, options.encoding);
  const library = await loadLibrary();
  const csv = ending === ".csv";
  const choices = { deck: options.deck ?? null, deckName: null, separator: options.separator, csv, directions: {}, split: Boolean(options.split), list };
  const read = (from) => planImport(from, text, choices);
  let plan = read(library);

  if (anki) out(t("import.anki.read", { decks: anki.decks.join(", ") }));
  else out(t("import.reading", { file: file === "-" ? t("import.stdin") : file, what: describeRead(plan.read) }) + (encoding === "utf-8" ? "" : t("import.encoding", { encoding: encoding.toUpperCase() })));
  if (!plan.read.count) throw new Error(t("import.empty"));
  if (plan.read.ignored.length) out(t("import.ignored", { count: plan.read.ignored.length, lines: lineList(plan.read.ignored) }));
  if (plan.read.media) out(t("import.mediaLeft", { count: plan.read.media }));
  // Dracosh's decks don't nest: "Spanish::Verbs" is a deck of its own
  const nested = plan.decks.find((deck) => !deck.deck && deck.name.includes("::"));
  if (isPackage && nested) out(t("import.subdecks", { deck: nested.name }));
  // Anki's export without HTML runs an answer and its example together
  if (plan.read.anki && !plan.read.html) out(t("import.ankiNoHtml"));

  // the deck for cards the file doesn't put in one: --deck, or asked once the cards are on screen,
  // or named after the file
  if (plan.problems.some((p) => p.issue === "noDeck")) {
    const suggested = file === "-" ? "" : deckFromFile(file);
    if (interactive) {
      const sample = readSample(text, choices);
      out();
      for (const fields of sample.slice(0, 3)) out(`  ${cut(cardText(fields))}`);
      more(sample.length - 3);
      const own = library.decks.filter((d) => !d.tour);
      const existing = suggested && own.find((d) => d.name.toLowerCase() === suggested.toLowerCase());
      out();
      if (own.length) out(t("import.yourDecks", { decks: own.map((d) => d.name).join(", ") }));
      const question = existing
        ? t("import.askDeckYours", { deck: existing.name, cards: t("count.cards", { count: cardsOf(library, existing.id).length }) })
        : suggested
          ? t("import.askDeck", { deck: suggested })
          : t("import.askDeckEmpty");
      choices.deckName = (await ask(question)) || existing?.name || suggested;
    } else choices.deckName = suggested;
    if (!choices.deckName) throw new Error(t("import.needDeck"));
    plan = read(library);
  }

  // "cat, kitty": one answer listing several, as Anki and Quizlet decks often have them
  if (plan.read.splittable && !choices.split) {
    out();
    out(t("import.listed", { count: plan.read.splittable, example: cut(plan.read.splitExample, 40) }));
    if (interactive && !options.yes) {
      choices.split = await confirm(t("import.splitAsk"), true);
      if (choices.split) plan = read(library);
    } else out(t("import.splitHint"));
  }

  const showPlan = () => {
    for (const target of plan.decks) {
      const added = target.items.filter((item) => item.kind === "new");
      if (target.deck && !added.length) continue; // what's there already or changed is told below
      out();
      out(target.deck ? t("import.intoDeck", { deck: target.name, cards: t("count.cards", { count: cardsOf(library, target.deck.id).length }) }) : t("import.intoNewDeck", { deck: target.name }));
      for (const item of added.slice(0, 3)) out(`  + ${cut(cardText(item.fields))}${item.fields.example ? `  // ${cut(item.fields.example, 30)}` : ""}`);
      more(added.length - 3);
      // a new deck's languages, as they'll be guessed: seen before saving, and fixed in /decks
      if (!target.deck) {
        const languages = deckLanguages({ name: target.name }, target.items.map((item) => item.fields));
        const sure = isKnown(languages.front) && isKnown(languages.back) && languages.front !== languages.back;
        out(`  ${sure ? t("import.languagesGuess", { front: languageName(languages.front), back: languageName(languages.back) }) : t("import.languagesUnsure")}`);
      }
    }
    const counts = planCounts(plan);
    out();
    out([t("import.counts.new", { count: counts.new }), counts.same && t("import.counts.same", { count: counts.same }), counts.changed && t("import.counts.changed", { count: counts.changed })].filter(Boolean).join(" · "));
    showProblems(plan.problems.filter((p) => p.issue !== "noDeck"), isPackage);
  };
  showPlan();

  // cards already in the deck with other answers: never updated without asking
  // true: every changed card; a Set: the ones shown here and agreed to
  let update = Boolean(options.update);
  const changed = plan.decks.flatMap((deck) => deck.items.filter((item) => item.kind === "changed"));
  if (changed.length) {
    out();
    out(t("import.changedTitle", { count: changed.length }));
    for (const item of changed.slice(0, SHOWN)) {
      const before = item.card.cloze ? plainFront(item.card.front) : answers(item.card.back);
      const after = item.fields.cloze ? plainFront(item.fields.front) : answers(item.fields.back);
      const example = item.fields.example && item.fields.example !== item.card.example ? `  // ${cut(item.fields.example, 30)}` : "";
      out(`  ${cut(plainFront(item.card.front), 30)}:  ${cut(before, 30)}  →  ${cut(after, 30)}${example}`);
    }
    more(changed.length - SHOWN);
    if (!options.update && interactive && !options.yes) update = (await confirm(t("import.updateAsk", { count: changed.length }), false)) && new Set(changed.map((item) => item.card.id));
    else if (!options.update) out(t("import.changedLeft"));
  }

  const adding = planCounts(plan).new;
  const updating = update ? changed.length : 0;
  if (!adding && !updating) {
    // nothing to add, but cards found in Anki are remembered as such (a preview saves nothing)
    if ((interactive || options.yes) && markFromAnki(structuredClone(library), plan)) {
      const fresh = await loadLibrary();
      if (markFromAnki(fresh, read(fresh))) await saveLibrary(fresh);
    }
    out();
    return out(t("import.nothing"));
  }

  // how the new decks ask, unless the file says (#direction:): one question for all of them
  const unasked = plan.decks.filter((deck) => !deck.deck && !deck.direction);
  const sample = unasked.flatMap((deck) => deck.items).find((item) => !item.fields.cloze)?.fields;
  if (sample && interactive && !options.yes) {
    out();
    out(unasked.length === 1 ? t("import.directionTitle", { deck: unasked[0].name }) : t("import.directionTitleMany", { count: unasked.length }));
    out(`  1  ${cut(sample.front, 30)} → ?   ${t("add.youType", { answer: cut(answers(sample.back), 30) })}`);
    out(`  2  ${cut(answers(sample.back), 30)} → ?   ${t("add.youType", { answer: cut(sample.front, 30) })}`);
    out(`  3  ${t("add.bothWays")}`);
    let picked = null;
    while (!picked) picked = { "": "forward", 1: "forward", 2: "backward", 3: "both" }[await ask(t("import.directionAsk"))] ?? null;
    for (const deck of unasked) choices.directions[deck.name] = picked;
    // the answers typed now may start with "/": those cards are named before anything is saved
    const before = plan.problems.length;
    plan = read(library);
    showProblems(plan.problems.slice(before).filter((p) => p.issue === "slash"), isPackage);
  }

  const counts = planCounts(plan);
  const willUpdate = update ? counts.changed : 0;
  if (!options.yes) {
    if (!interactive) {
      out();
      const deckFlag = options.deck ? ` --deck ${shellQuote(options.deck)}` : file === "-" ? ` --deck ${shellQuote(choices.deckName)}` : "";
      const source = anki ? `--anki${file ? ` ${shellQuote(file)}` : ""}` : shellQuote(file);
      return out(t("import.previewOnly", { command: `dracosh import ${source}${deckFlag}${choices.split ? " --split" : ""} --yes` }));
    }
    out();
    const question = !willUpdate
      ? t("import.confirmAdd", { count: counts.new })
      : !counts.new
        ? t("import.confirmUpdate", { count: willUpdate })
        : t("import.confirmBoth", { cards: t("count.cards", { count: counts.new }), count: willUpdate });
    if (!(await confirm(question, true))) return out(t("cli.restore.nothingChanged"));
  }

  // the backup first, then read, change and save in one go: a quiz running meanwhile may have added cards
  const backup = await backupNow("before-import"); // null on a first run: there's nothing to lose yet
  const running = runningPid();
  const state = running ? null : await loadState(); // read (and checked) before anything is written
  const fresh = await loadLibrary();
  const final = read(fresh);
  const result = applyImport(fresh, final, { update, directions: choices.directions, keepTour: !state });
  await saveLibrary(fresh);
  // the tour's progress goes with it (a running quiz keeps the progress in memory: the tour stays then)
  if (result.removedTour.length) {
    const gone = new Set(result.removedTour);
    for (const key of Object.keys(state.items)) if (gone.has(key.split(":")[0])) delete state.items[key];
    await saveState(state);
  }

  out();
  for (const deck of result.decks) {
    if (deck.isNew) out(t("import.doneNew", { deck: deck.name, count: deck.added }));
    else if (!deck.added) out(t("import.doneOnlyUpdated", { deck: deck.name, count: deck.updated }));
    else out(t("import.done", { deck: deck.name, count: deck.added }) + (deck.updated ? t("import.doneUpdated", { count: deck.updated }) : ""));
  }
  for (const left of result.slash) out(`  ${t("import.problemLine", { line: left.line, issue: t("import.issues.slash"), text: cut(left.text, 50) })}`);
  if (result.removedTour.length) out(t("import.tourGone"));
  if (backup) out(t("import.undo"));
  const first = result.decks.find((d) => d.isNew) ?? result.decks[0];
  // a name with a quote in it is quoted the other way, so the command can be pasted as it is
  const quoted = (name) => (name.includes('"') ? `'${name.replace(/'/g, "'\\''")}'` : `"${name}"`);
  if (first) out(running ? t("import.inDecks") : t("import.start", { deck: quoted(first.name) }));
}

// "3, 7, 9…": the first few line numbers of a list
const lineList = (lines) => lines.slice(0, 5).join(", ") + (lines.length > 5 ? "…" : "");

function showProblems(problems, notes = false) {
  if (!problems.length) return;
  out(t(notes ? "import.problemsNotes" : "import.problems", { count: problems.length }));
  for (const problem of problems.slice(0, SHOWN)) out(`  ${t(notes ? "import.problemNote" : "import.problemLine", { line: problem.line, issue: issueText(problem, notes), text: cut(problem.text.replace(/\t/g, "  "), 50) })}`);
  more(problems.length - SHOWN);
}

// the cards as read, before any deck is picked: for the question which deck they go into
const readSample = (text, { separator, csv, list }) => (list ?? readCardList(text, { separator, csv })).items.map((item) => item.fields).filter((fields) => fields.front);

// a file in Dracosh's own folder (library.json, a backup…) is never written over by an export
function insideData(file) {
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return existsSync(dirname(path)) ? resolve(realpathSync(dirname(path)), basename(path)) : resolve(path);
    }
  };
  const home = real(HOME);
  const target = real(file);
  const inside = relative(home, target);
  return target === home || (!inside.startsWith("..") && !inside.startsWith("/") && inside !== "") || Object.values(DATA_FILES).some((data) => real(data) === target);
}

export async function runExport(file, options) {
  if (options.anki) return exportToAnki(file, options);
  if (!file) throw new Error(t("export.needFile"));
  const format = file === "-" ? "txt" : extname(file).slice(1).toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) throw new Error(t("export.unknownFormat", { file }));
  if (format === "json" && options.deck) throw new Error(t("export.jsonAll"));
  // a Node without what Anki packages need is said before anything is asked
  if (format === "apkg") {
    try {
      await loadSqlite();
    } catch (err) {
      throw needsNode(err, "export.needsNode");
    }
  }

  const library = await loadLibrary();
  let decks = library.decks.filter((deck) => !deck.tour);
  if (options.deck) {
    const deck = findDeck(library, options.deck);
    if (!deck) throw missingDeck(library, options.deck);
    decks = [deck];
  }
  if (format !== "json" && !decks.length) throw new Error(t("export.noDecks"));

  if (file !== "-" && insideData(file)) throw new Error(t("export.inData", { home: HOME }));
  if (file !== "-" && existsSync(file) && !options.yes) {
    if (!process.stdin.isTTY) throw new Error(t("export.existsNeedsYes", { file }));
    if (!(await confirm(t("export.exists", { file }), false))) return out(t("cli.restore.nothingChanged"));
  }

  const write = async (path, text) => {
    try {
      await writeFile(path, format === "csv" ? `\uFEFF${text}` : text); // the BOM tells Excel it's UTF-8
    } catch (err) {
      throw new Error(t("export.cantWrite", { file: path, error: err.code === "ENOENT" ? t("export.noFolder") : err.message }));
    }
  };
  const count = (cloze) => decks.reduce((sum, deck) => sum + cardsOf(library, deck.id).filter((card) => cloze === undefined || Boolean(card.cloze) === cloze).length, 0);

  // for Anki, cloze cards go into a file of their own, next to the others ("spanish-cloze.tsv")
  if (format === "tsv" && count(true)) {
    const clozeFile = count(false) ? file.replace(/\.tsv$/i, "-cloze.tsv") : file;
    if (clozeFile !== file && !options.yes && existsSync(clozeFile)) {
      if (!process.stdin.isTTY) throw new Error(t("export.existsNeedsYes", { file: clozeFile }));
      if (!(await confirm(t("export.exists", { file: clozeFile }), false))) return out(t("cli.restore.nothingChanged"));
    }
    if (count(false)) {
      await write(file, toAnki(library, decks));
      out(t("export.wrote", { count: count(false), file }));
      out(t("export.next.tsv", { file }));
    }
    await write(clozeFile, toAnki(library, decks, { cloze: true }));
    out(t("export.wroteCloze", { count: count(true), file: clozeFile }));
    return out(t("export.nextCloze", { file: clozeFile }));
  }

  const contents = {
    json: async () => `${JSON.stringify(await backupData("export"), null, 2)}\n`,
    apkg: () => toApkg(library, decks),
    tsv: () => toAnki(library, decks),
    csv: () => toCsv(library, decks),
    txt: () => toDracoshText(library, decks)
  };
  const text = await contents[format]();
  if (file === "-") return process.stdout.write(text);
  await write(file, text);
  out(format === "json" ? t("export.wroteAll", { file }) : t("export.wrote", { count: count(), file }));
  out(t(`export.next.${format}`, { file }));
  const fromAnki = decks.reduce((sum, deck) => sum + cardsOf(library, deck.id).filter((card) => card.fromAnki).length, 0);
  if (format === "apkg" && fromAnki) out(t("export.fromAnkiCopies", { count: fromAnki }));
}

// `dracosh export --anki`: the decks sent straight to a running Anki, as an .apkg its own importer
// takes (what File → Import does). It changes Anki's collection, so it's asked first.
async function exportToAnki(file, options) {
  if (file) throw new Error(t("export.anki.noFile"));
  try {
    await loadSqlite();
  } catch (err) {
    throw needsNode(err, "export.needsNode");
  }
  const library = await loadLibrary();
  // cards from Anki's own notes are there already: sent again they'd be a second copy
  const sendable = (deck) => cardsOf(library, deck.id).filter((card) => !card.fromAnki);
  let decks = library.decks.filter((deck) => !deck.tour);
  if (options.deck) {
    const deck = findDeck(library, options.deck);
    if (!deck) throw missingDeck(library, options.deck);
    decks = [deck];
  }
  const fromAnki = decks.reduce((sum, deck) => sum + cardsOf(library, deck.id).length - sendable(deck).length, 0);
  decks = decks.filter((deck) => sendable(deck).length);
  if (fromAnki) out(t("export.anki.fromAnki", { count: fromAnki }));
  if (!decks.length) throw new Error(t(fromAnki ? "export.anki.nothingNew" : "export.noDecks"));
  const cards = t("count.cards", { count: decks.reduce((sum, deck) => sum + sendable(deck).length, 0) });
  const names = decks.map((deck) => deck.name).join(", ");
  const anki = connect();
  try {
    // Anki is there before anything is asked, and its Dracosh note types are as Dracosh writes them:
    // a note type someone changed in Anki would lose what they added when its notes are updated
    for (const { id, fields } of NOTE_TYPE_FIELDS) {
      const inAnki = await noteType(anki, id);
      if (inAnki && inAnki.fields.join("\u0001") !== fields.join("\u0001")) throw new Error(t("export.anki.changedNoteType", { type: inAnki.name, fields: inAnki.fields.join(", ") }));
    }
  } catch (err) {
    throw ankiError(err);
  }
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error(t("export.anki.needsYes"));
    if (!(await confirm(t("export.anki.ask", { cards, decks: names }), true))) return out(t("cli.restore.nothingChanged"));
  }
  const folder = mkdtempSync(join(tmpdir(), "dracosh-anki-"));
  try {
    const path = join(folder, "dracosh.apkg");
    await writeFile(path, await toApkg(library, decks, { skip: (card) => card.fromAnki }));
    await importIntoAnki(anki, path);
  } catch (err) {
    throw ankiError(err);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  out(t("export.anki.sent", { cards, decks: names }));
}
