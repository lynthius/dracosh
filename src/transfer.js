import { t } from "./i18n.js";
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { backupData, backupNow, restoreBackup } from "./backup.js";
import { plainFront } from "./cardline.js";
import { readCardList, separatorNamed } from "./cardlist.js";
import { applyImport, decodeText, planCounts, planImport } from "./importer.js";
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
const out = (text = "") => console.log(text);

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
const yes = (answer) => t("cli.restore.yes").split("|").includes(answer.toLowerCase());
const answers = (back) => back.join("; ");
// a cloze card keeps its {{gaps}} in the preview, so you see what will be asked
const cardText = (fields) => (fields.back.length ? `${fields.front} = ${answers(fields.back)}` : fields.front);
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

function issueText(problem) {
  if (problem.issue === "twice") return t("import.issues.twice", { line: problem.first });
  if (problem.issue === "tooLong") return t("import.issues.tooLong", { max: MAX_DECK_NAME, deck: cut(problem.deck, 30) });
  if (problem.issue === "tour") return t("import.issues.tour", { deck: problem.deck });
  return t(`import.issues.${problem.issue}`);
}

async function readInput(file, encoding) {
  if (file === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return decodeText(Buffer.concat(chunks), encoding);
  }
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? t("import.noFile", { file }) : t("errors.cantRead", { file, error: err.message }));
  }
  try {
    return decodeText(bytes, encoding);
  } catch (err) {
    if (!err.samples) throw err;
    const lines = err.samples.map((sample) => `  --encoding ${sample.encoding}   ${sample.line}`);
    throw new Error([t("import.notUtf8", { file }), ...lines, t("import.notUtf8Hint")].join("\n"));
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
  out(`  ${t("cli.restore.row", { decks: t("count.decks", { count: library?.decks?.length ?? 0 }), cards: t("count.cards", { count: library?.cards?.length ?? 0 }), practised: Object.keys(state?.items ?? {}).length })}`);
  if (Object.values(DATA_FILES).some((data) => existsSync(data))) out(t("cli.restore.undo"));
  if (!sure) {
    if (!process.stdin.isTTY) throw new Error(t("cli.restore.needsYes"));
    if (!yes(await ask(`${t("import.backupAsk")} ${t("cli.restore.askSuffix")} `))) return out(t("cli.restore.nothingChanged"));
  }
  await restoreBackup(file);
  out(t("cli.restore.done"));
}

export async function runImport(file, options) {
  if (!file) throw new Error(t("import.needFile"));
  const isJson = file !== "-" && extname(file).toLowerCase() === ".json";
  if (isJson) return importBackup(file, options);
  const interactive = process.stdin.isTTY && file !== "-";
  if (options.separator !== undefined && !separatorNamed(options.separator)) throw new Error(t("import.badSeparator", { value: options.separator }));
  const { text, encoding } = await readInput(file, options.encoding);
  const library = await loadLibrary();
  const csv = file !== "-" && extname(file).toLowerCase() === ".csv";
  const choices = { deck: options.deck ?? null, deckName: null, separator: options.separator, csv, directions: {}, split: Boolean(options.split) };
  const read = (from) => planImport(from, text, choices);
  let plan = read(library);

  out(t("import.reading", { file: file === "-" ? t("import.stdin") : file, what: describeRead(plan.read) }) + (encoding === "utf-8" ? "" : t("import.encoding", { encoding: encoding.toUpperCase() })));
  if (!plan.read.count) throw new Error(t("import.empty"));
  if (plan.read.ignored.length) out(t("import.ignored", { count: plan.read.ignored.length, lines: lineList(plan.read.ignored) }));

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
      choices.split = yes((await ask(`${t("import.splitAsk")} ${t("import.askSuffix")} `)) || t("cli.restore.yes").split("|")[0]);
      if (choices.split) plan = read(library);
    } else out(t("import.splitHint"));
  }

  const showPlan = () => {
    for (const target of plan.decks) {
      const added = target.items.filter((item) => item.kind === "new");
      out();
      out(target.deck ? t("import.intoDeck", { deck: target.name, cards: t("count.cards", { count: cardsOf(library, target.deck.id).length }) }) : t("import.intoNewDeck", { deck: target.name }));
      for (const item of added.slice(0, 3)) out(`  + ${cut(cardText(item.fields))}${item.fields.example ? `  // ${cut(item.fields.example, 30)}` : ""}`);
      more(added.length - 3);
    }
    const counts = planCounts(plan);
    out();
    out([t("import.counts.new", { count: counts.new }), counts.same && t("import.counts.same", { count: counts.same }), counts.changed && t("import.counts.changed", { count: counts.changed })].filter(Boolean).join(" · "));
    showProblems(plan.problems.filter((p) => p.issue !== "noDeck"));
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
    if (!options.update && interactive && !options.yes) update = yes(await ask(`${t("import.updateAsk", { count: changed.length })} ${t("cli.restore.askSuffix")} `)) && new Set(changed.map((item) => item.card.id));
    else if (!options.update) out(t("import.changedLeft"));
  }

  const adding = planCounts(plan).new;
  const updating = update ? changed.length : 0;
  if (!adding && !updating) {
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
    showProblems(plan.problems.slice(before).filter((p) => p.issue === "slash"));
  }

  const counts = planCounts(plan);
  const willUpdate = update ? counts.changed : 0;
  if (!options.yes) {
    if (!interactive) {
      out();
      const deckFlag = options.deck ? ` --deck "${options.deck}"` : file === "-" ? ` --deck "${choices.deckName}"` : "";
      return out(t("import.previewOnly", { command: `dracosh import ${file}${deckFlag}${choices.split ? " --split" : ""} --yes` }));
    }
    out();
    const question = !willUpdate
      ? t("import.confirmAdd", { count: counts.new })
      : !counts.new
        ? t("import.confirmUpdate", { count: willUpdate })
        : t("import.confirmBoth", { cards: t("count.cards", { count: counts.new }), count: willUpdate });
    const answer = await ask(`${question} ${t("import.askSuffix")} `);
    if (answer && !yes(answer)) return out(t("cli.restore.nothingChanged"));
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
  for (const left of result.slash) out(`  ${t("import.line", { line: left.line })}  ${t("import.issues.slash")}: ${cut(left.text, 50)}`);
  for (const deck of result.decks.filter((d) => d.isNew)) {
    const created = findDeck(fresh, deck.name);
    const languages = deckLanguages(created, cardsOf(fresh, created.id));
    if (isKnown(languages.front) && isKnown(languages.back) && languages.front !== languages.back) out(t("import.languages", { deck: deck.name, front: languageName(languages.front), back: languageName(languages.back) }));
  }
  if (result.removedTour.length) out(t("import.tourGone"));
  if (backup) out(t("import.undo"));
  const first = result.decks.find((d) => d.isNew) ?? result.decks[0];
  // a name with a quote in it is quoted the other way, so the command can be pasted as it is
  const quoted = (name) => (name.includes('"') ? `'${name.replace(/'/g, "'\\''")}'` : `"${name}"`);
  if (first) out(running ? t("import.inDecks") : t("import.start", { deck: quoted(first.name) }));
}

// "3, 7, 9…": the first few line numbers of a list
const lineList = (lines) => lines.slice(0, 5).join(", ") + (lines.length > 5 ? "…" : "");

function showProblems(problems) {
  if (!problems.length) return;
  out(t("import.problems", { count: problems.length }));
  for (const problem of problems.slice(0, SHOWN)) out(`  ${t("import.line", { line: problem.line })}  ${issueText(problem)}: ${cut(problem.text.replace(/\t/g, "  "), 50)}`);
  more(problems.length - SHOWN);
}

// the cards as read, before any deck is picked: for the question which deck they go into
const readSample = (text, { separator, csv }) => readCardList(text, { separator, csv }).items.map((item) => item.fields).filter((fields) => fields.front);

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
  if (!file) throw new Error(t("export.needFile"));
  const format = file === "-" ? "txt" : extname(file).slice(1).toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) throw new Error(t("export.unknownFormat", { file }));
  if (format === "json" && options.deck) throw new Error(t("export.jsonAll"));

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
    if (!yes(await ask(`${t("export.exists", { file })} ${t("cli.restore.askSuffix")} `))) return out(t("cli.restore.nothingChanged"));
  }

  const text =
    format === "json" ? `${JSON.stringify(await backupData("export"), null, 2)}\n` : format === "csv" ? toCsv(library, decks) : format === "tsv" ? toAnki(library, decks) : toDracoshText(library, decks);
  if (file === "-") return process.stdout.write(text);
  try {
    await writeFile(file, format === "csv" ? `\uFEFF${text}` : text); // the BOM tells Excel it's UTF-8
  } catch (err) {
    throw new Error(t("export.cantWrite", { file, error: err.code === "ENOENT" ? t("export.noFolder") : err.message }));
  }
  const cards = decks.reduce((sum, deck) => sum + cardsOf(library, deck.id).length, 0);
  out(format === "json" ? t("export.wroteAll", { file }) : t("export.wrote", { count: cards, file }));
  out(t(`export.next.${format}`, { file }));
}
