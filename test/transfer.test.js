import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyImport, decodeText, planCounts, planImport } from "../src/importer.js";
import { toAnki, toCsv, toDracoshText } from "../src/exporter.js";
import { readCardList } from "../src/cardlist.js";
import { gapsOf, plainFront } from "../src/cardline.js";
import { addCard, cardsOf, createDeck, emptyLibrary } from "../src/library.js";
import { readZip } from "../src/zip.js";

const library = () => {
  const lib = emptyLibrary();
  const deck = createDeck(lib, { name: "Spanish", directions: "forward" });
  addCard(lib, deck.id, { front: "el gato", back: ["the cat"], example: "Mi gato duerme." });
  addCard(lib, deck.id, { front: "el perro", back: ["the dog"] });
  return { lib, deck };
};

test("a plan sorts the lines: new, already there, other answers, and what can't be added", () => {
  const { lib } = library();
  const plan = planImport(lib, "el gato = the cat\nel perro = the hound\nla casa = the house\nla mesa\nla casa = the home", { deckName: "Spanish" });
  assert.deepEqual(planCounts(plan), { new: 1, same: 1, changed: 1, problems: 2 });
  assert.deepEqual(plan.problems.map((p) => [p.line, p.issue, p.first]), [
    [4, "noSeparator", undefined],
    [5, "twice", 3]
  ]);
});

test("a fixed accent or letter case is a change; the same answers in another order aren't", () => {
  const { lib } = library();
  assert.equal(planCounts(planImport(lib, "el perro = the Dog", { deckName: "Spanish" })).changed, 1);
  assert.equal(planCounts(planImport(lib, "el gato = the cat", { deckName: "Spanish" })).same, 1);
});

test("only the changed cards that were shown are updated", () => {
  const { lib, deck } = library();
  const plan = planImport(lib, "el perro = the hound\nel gato = the kitty", { deckName: "Spanish" });
  const perro = cardsOf(lib, deck.id).find((c) => c.front === "el perro");
  applyImport(lib, plan, { update: new Set([perro.id]) });
  assert.deepEqual(cardsOf(lib, deck.id).map((c) => c.back[0]), ["the cat", "the hound"]);
});

test("cards already there change only when asked; their id, and so their progress, stays", () => {
  const { lib, deck } = library();
  const before = cardsOf(lib, deck.id).find((c) => c.front === "el perro");
  const plan = planImport(lib, "el perro = the hound", { deckName: "Spanish" });
  applyImport(lib, plan);
  assert.deepEqual(before.back, ["the dog"], "left as it is without update");
  applyImport(lib, plan, { update: true });
  const after = cardsOf(lib, deck.id).find((c) => c.front === "el perro");
  assert.equal(after.id, before.id);
  assert.deepEqual(after.back, ["the hound"]);
});

test("importing the same file twice adds nothing the second time", () => {
  const { lib } = library();
  const text = "la casa = the house\nla mesa = the table";
  applyImport(lib, planImport(lib, text, { deckName: "Spanish" }));
  assert.deepEqual(planCounts(planImport(lib, text, { deckName: "Spanish" })), { new: 0, same: 2, changed: 0, problems: 0 });
});

test("--deck puts every card into one deck, over the file's own #deck lines", () => {
  const { lib } = library();
  const plan = planImport(lib, "#deck:Other\nla casa = the house", { deck: "Spanish" });
  assert.deepEqual(plan.decks.map((d) => d.name), ["Spanish"]);
});

test("new decks get the file's direction, or the one picked; the tour goes once you have a deck", () => {
  const lib = emptyLibrary();
  const tour = createDeck(lib, { name: "Getting started", tour: true });
  addCard(lib, tour.id, { front: "hello", back: ["hi"] });
  const plan = planImport(lib, "#deck:One\n#direction:both\na = b\n#deck:Two\nc = d");
  const result = applyImport(lib, plan, { directions: { Two: "backward" } });
  assert.deepEqual(lib.decks.map((d) => [d.name, d.directions]), [["One", "both"], ["Two", "backward"]]);
  assert.equal(result.removedTour.length, 1);
});

test("a card whose typed answer would start with / is named in the plan, before anything is saved", () => {
  const lib = emptyLibrary();
  const plan = planImport(lib, "slash = /x\nok = fine\n/front = fine", { deckName: "D" });
  assert.deepEqual(plan.problems.map((p) => [p.line, p.issue]), [[1, "slash"]], "the front isn't typed when the deck asks front → back");
  assert.equal(applyImport(lib, plan).added, 2);
  const both = planImport(emptyLibrary(), "/front = fine", { deckName: "D", directions: { D: "both" } });
  assert.deepEqual(both.problems.map((p) => p.issue), ["slash"]);
});

test("decodeText: UTF-8 with a BOM, UTF-16 from Excel, and no silent guess for anything else", () => {
  assert.equal(decodeText(Buffer.from("\uFEFFżółw", "utf8")).text, "żółw");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("kot\tcat", "utf16le")]);
  assert.deepEqual(decodeText(utf16), { text: "kot\tcat", encoding: "utf-16le" });
  const cp1250 = Buffer.from([0xbf, 0xf3, 0xb3, 0x77]); // "żółw" in windows-1250
  assert.throws(() => decodeText(cp1250), (err) => err.samples?.[0].line === "żółw");
  assert.equal(decodeText(cp1250, "windows-1250").text, "żółw");
});

test("exports read back as the same cards: .txt exactly, .csv and Anki's .tsv by content", () => {
  const { lib, deck } = library();
  addCard(lib, deck.id, { front: "I {{look}} at {{it}}", back: ["a hint"], example: "An example.", cloze: true });
  addCard(lib, deck.id, { front: "#tag", back: ["one; two", "three"], example: "a, \"quoted\" one" });
  addCard(lib, deck.id, { front: "\\#raw", back: ["x"] });
  addCard(lib, deck.id, { front: "I \\{{kept}} and {{gap}} {{ }}", back: [], cloze: true });
  const original = cardsOf(lib, deck.id).map((c) => [c.front, c.back, c.example, Boolean(c.cloze)]);
  const read = (text, options) => readCardList(text, options).items.map(({ fields }) => [fields.front, fields.back, fields.example, fields.cloze]);
  assert.deepEqual(read(toDracoshText(lib, [deck])), original);
  assert.deepEqual(read(toCsv(lib, [deck]), { csv: true }), original);
  // one note type per file: Anki names them in its own language, and a mixed file would import nothing
  const basic = toAnki(lib, [deck]);
  const cloze = toAnki(lib, [deck], { cloze: true });
  assert.match(basic, /^#separator:tab\n#html:true\n#notetype:Basic\n#deck:Spanish\nel gato\t/);
  assert.match(cloze, /^#separator:tab\n#html:true\n#notetype:Cloze\n#deck:Spanish\nI \{\{c1::look\}\} at \{\{c2::it\}\}\ta hint<br>An example.\n/);
  // Anki has no "{{ }}" that isn't a gap, so it comes back as "\{{ }}": the same card, written another way
  const asked = (cards) => cards.map(([front, ...rest]) => [plainFront(front), gapsOf(front), ...rest]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(asked([...read(basic), ...read(cloze)]), asked(original));
  assert.deepEqual(read(basic)[0], ["el gato", ["the cat"], "Mi gato duerme.", false]);
  // Anki shows a cloze note's Extra field after the answer, so a hint on its own comes back as the example
  const hintOnly = library();
  addCard(hintOnly.lib, hintOnly.deck.id, { front: "I {{see}} it", back: ["verb"], cloze: true });
  assert.deepEqual(read(toAnki(hintOnly.lib, [hintOnly.deck], { cloze: true })), [["I {{see}} it", [], "verb", true]]);
});

const CLI = new URL("../src/cli.js", import.meta.url).pathname;
const env = (home) => ({ ...process.env, DRACOSH_HOME: home, LC_ALL: "", LC_MESSAGES: "", LANG: "en_US.UTF-8" });
const run = (home, args, input) => spawnSync(process.execPath, [CLI, ...args], { env: env(home), input, encoding: "utf8" });

test("dracosh import: without --yes outside a terminal it only shows the plan", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const result = run(home, ["import", "-", "--deck", "Spanish"], "el gato = the cat\nla mesa\n");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Into a new deck, Spanish:\n  \+ el gato = the cat/);
  assert.match(result.stdout, /line 2  no " = " between front and answer: la mesa/);
  assert.match(result.stdout, /Preview only, nothing saved\. To import: dracosh import - --deck "Spanish" --yes/);
  assert.equal(existsSync(join(home, "library.json")), false, "nothing written");
});

test("dracosh import --yes writes, backs up first, and export → import gives the same file", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const file = join(home, "spanish.txt");
  writeFileSync(file, "el gato = the cat; the kitty // Mi gato duerme.\nel perro = the dog\n");
  const first = run(home, ["import", file, "--yes"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Made the deck spanish with 2 cards\./);
  assert.doesNotMatch(first.stdout, /restore/, "nothing to back up on a first run");
  const second = run(home, ["import", "-", "--deck", "spanish", "--yes"], "la casa = the house\n");
  assert.match(second.stdout, /Added 1 card to spanish\.\n.*dracosh restore 1/);
  assert.equal(readdirSync(join(home, "backups")).filter((name) => name.endsWith("-before-import.json")).length, 1);
  const files = mkdtempSync(join(tmpdir(), "dracosh-files-"));
  const out = join(files, "out.txt");
  execFileSync(process.execPath, [CLI, "export", out], { env: env(home) });
  const other = mkdtempSync(join(tmpdir(), "dracosh-"));
  assert.equal(run(other, ["import", out, "--yes"]).status, 0);
  const again = join(files, "again.txt");
  execFileSync(process.execPath, [CLI, "export", again], { env: env(other) });
  const body = (path) => readFileSync(path, "utf8").split("\n").slice(2).join("\n");
  assert.equal(body(again), body(out));
});

test("dracosh export: refuses to overwrite without --yes, and a .json export restores everything", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  run(home, ["import", "-", "--deck", "D", "--yes"], "a = b\n");
  const out = join(mkdtempSync(join(tmpdir(), "dracosh-files-")), "all.json");
  assert.equal(run(home, ["export", out]).status, 0);
  const again = run(home, ["export", out]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already there: add --yes/);
  const other = mkdtempSync(join(tmpdir(), "dracosh-"));
  const restored = run(other, ["import", out, "--yes"]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(readFileSync(join(other, "library.json"), "utf8"), /"front": "a"/);
});

test("dracosh export never writes into Dracosh's own folder", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  run(home, ["import", "-", "--deck", "D", "--yes"], "a = b\n");
  const result = run(home, ["export", join(home, "library.json"), "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Dracosh's own folder/);
  assert.match(readFileSync(join(home, "library.json"), "utf8"), /"front": "a"/);
});

test("a .json that isn't a usable backup is refused before anything is written", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  run(home, ["import", "-", "--deck", "D", "--yes"], "a = b\n");
  const bad = join(mkdtempSync(join(tmpdir(), "dracosh-files-")), "bad.json");
  writeFileSync(bad, JSON.stringify({ format: 1, files: { library: { cards: "oops" } } }));
  const result = run(home, ["import", bad, "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(readFileSync(join(home, "library.json"), "utf8"), /"front": "a"/);
});

test("answers listed with commas or slashes are split only when asked; sentences never", () => {
  const text = "gato\tcat, kitty\nperro\tdog / hound\nsí\tYes, I do.";
  const lib = emptyLibrary();
  const asIs = planImport(lib, text, { deckName: "D" });
  assert.equal(asIs.read.splittable, 2);
  assert.equal(asIs.read.splitExample, "cat, kitty");
  assert.deepEqual(asIs.decks[0].items.map((item) => item.fields.back), [["cat, kitty"], ["dog / hound"], ["Yes, I do."]]);
  const split = planImport(lib, text, { deckName: "D", split: true });
  assert.deepEqual(split.decks[0].items.map((item) => item.fields.back), [["cat", "kitty"], ["dog", "hound"], ["Yes, I do."]]);
  assert.equal(planImport(lib, "gato = cat, kitty", { deckName: "D" }).read.splittable, 0, "a Dracosh line means what it says");
});

test("a big deck is planned quickly: 20 000 cards against 20 000 already there", () => {
  const lib = emptyLibrary();
  const text = Array.from({ length: 20000 }, (_, i) => `word${i} = answer${i}`).join("\n");
  applyImport(lib, planImport(lib, text, { deckName: "Big" }));
  const started = performance.now();
  assert.equal(planCounts(planImport(lib, text, { deckName: "Big" })).same, 20000);
  assert.ok(performance.now() - started < 3000, "no card-by-card search of the whole deck");
});

test("braces in a card without gaps stay text through a .csv and back", () => {
  const lib = emptyLibrary();
  const deck = createDeck(lib, { name: "R" });
  addCard(lib, deck.id, { front: "plain {{not gap}}", back: ["braces"] });
  const [card] = readCardList(toCsv(lib, [deck]), { csv: true }).items.map((item) => item.fields);
  assert.deepEqual([card.front, card.cloze], ["plain {{not gap}}", false]);
});

test("damaged progress stops an import before anything is written; a bad --separator is an error", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  run(home, ["import", "-", "--deck", "D", "--yes"], "a = b\n");
  writeFileSync(join(home, "state.json"), JSON.stringify({ items: { x: { due: 1 } } }));
  const before = readFileSync(join(home, "library.json"), "utf8");
  const result = run(home, ["import", "-", "--deck", "D", "--yes"], "c = d\n");
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(home, "library.json"), "utf8"), before);
  const bad = run(home, ["import", "-", "--deck", "D", "--separator", "abc"], "c = d\n");
  assert.match(bad.stderr, /Unknown separator "abc"/);
});

test("a long nested Anki deck name keeps its last part; an empty answer isn't a missing \" = \"", () => {
  const plan = planImport(emptyLibrary(), "#deck:Languages::Spanish::Verbs and Expressions For Travel\nir = to go\ndormir =\n");
  assert.deepEqual(plan.decks.map((d) => d.name), ["Verbs and Expressions For Travel"]);
  assert.deepEqual(plan.problems.map((p) => p.issue), ["noBack"]);
});

test("a folder, a picture or a phrase: each is said for what it is", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const files = mkdtempSync(join(tmpdir(), "dracosh-files-"));
  assert.match(run(home, ["import", files]).stderr, /is a folder/);
  const png = join(files, "x.png");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  assert.match(run(home, ["import", png]).stderr, /isn't a text file/);
  assert.match(run(home, ["import", "a.txt", "b.txt"]).stderr, /one file at a time/);
  assert.match(run(home, ["--bogus"]).stderr, /Unknown option --bogus/);
  assert.equal(planImport(emptyLibrary(), "Hello, world\tCześć, świecie", { deckName: "D" }).read.splittable, 0);
});

test("dracosh export x.apkg writes an Anki package and says how to open it", async () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  assert.equal(run(home, ["import", "-", "--deck", "Spanish", "--yes"], "el gato = the cat\nElla {{come}}.\n").status, 0);
  const file = join(mkdtempSync(join(tmpdir(), "dracosh-out-")), "spanish.apkg");
  const result = run(home, ["export", file]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote 2 cards to .*spanish\.apkg\.\nIn Anki: double-click/);
  assert.equal(result.stderr, "", "no warning about SQLite being experimental");
  assert.deepEqual([...(await readZip(file, ["collection.anki2", "media"])).keys()], ["collection.anki2", "media"]);
});

test("dracosh import x.apkg: Anki's decks with how they ask, a picture card named, pictures and sounds left out", () => {
  const home = mkdtempSync(join(tmpdir(), "dracosh-"));
  const file = new URL("./fixtures/anki-modern.apkg", import.meta.url).pathname;
  const preview = run(home, ["import", file]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Reading .*anki-modern\.apkg: an Anki package\n2 notes have pictures or sounds/);
  assert.match(preview.stdout, /1 note can't be added:\n  note 6  a picture with parts to guess \(image occlusion\): Where\?/);
  assert.equal(preview.stderr, "");
  const result = run(home, ["import", file, "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  const library = JSON.parse(readFileSync(join(home, "library.json"), "utf8"));
  const decks = Object.fromEntries(library.decks.filter((deck) => !deck.tour).map((deck) => [deck.name, deck.directions]));
  assert.deepEqual(decks, { Spanish: "forward", "Spanish::Both ways": "both" });
  assert.equal(library.cards.filter((card) => card.cloze).length, 1);
  assert.equal(run(home, ["import", file, "--yes"]).stdout.match(/0 new cards · 6 already there/)?.length, 1, "a second import adds nothing");
});
