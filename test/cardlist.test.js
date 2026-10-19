import assert from "node:assert/strict";
import { test } from "node:test";
import { readCardList, splitRows } from "../src/cardlist.js";

const cards = (text, options) => readCardList(text, options).items.map(({ fields }) => [fields.front, fields.back.join("|"), fields.example]);

test("Dracosh lines: comments skipped, line numbers kept, \\# starts a card with #", () => {
  const list = readCardList("# my words\nel gato = the cat; the kitty // Mi gato duerme.\n\nel perro = the dog\n\\#tag = hashtag");
  assert.equal(list.format, "lines");
  assert.deepEqual(list.items.map((item) => item.line), [2, 4, 5]);
  assert.deepEqual(cards("el gato = the cat; the kitty // Mi gato duerme.\n\\#tag = hashtag"), [
    ["el gato", "the cat|the kitty", "Mi gato duerme."],
    ["#tag", "hashtag", ""]
  ]);
});

test("a spreadsheet's CSV: a header row names the columns, quotes hold commas, quotes and line breaks", () => {
  const list = readCardList('\uFEFFfront,back,example\r\ngato,cat,"Mi gato, ""Tom"", duerme"\r\n"la\r\ncasa",house\r\n');
  assert.equal(list.format, "table");
  assert.equal(list.separator, ",");
  assert.deepEqual(cards('front,back,example\ngato,cat,"Mi gato, ""Tom"", duerme"\n"la\ncasa",house\n'), [
    ["gato", "cat", 'Mi gato, "Tom", duerme'],
    ["la casa", "house", ""]
  ]);
  assert.deepEqual(list.items.map((item) => item.line), [2, 3]);
});

test("columns named in another order or language are read by their names", () => {
  assert.deepEqual(cards("Beispiel;Wort;Übersetzung\nDer Hund schläft.;der Hund;the dog", { csv: true }), [["der Hund", "the dog", "Der Hund schläft."]]);
  assert.deepEqual(cards("term\tdefinition\nkot\tcat"), [["kot", "cat", ""]]);
});

test("Excel's semicolons, and a .csv without a header", () => {
  const list = readCardList("gato;cat\nperro;dog", { csv: true });
  assert.equal(list.separator, ";");
  assert.deepEqual(cards("gato;cat\nperro;dog", { csv: true }), [["gato", "cat", ""], ["perro", "dog", ""]]);
});

test("sentences with commas stay sentences, not a table", () => {
  const list = readCardList("Yes, I do = Tak\nNo, I don't = Nie");
  assert.equal(list.format, "lines");
  assert.deepEqual(cards("Yes, I do = Tak"), [["Yes, I do", "Tak", ""]]);
  assert.equal(readCardList("Yes, I do\nNo, I don't").format, "lines");
});

test("an Anki export: its headers, HTML, cloze and the deck column", () => {
  const anki = "#separator:tab\n#html:true\n#notetype column:1\n#deck column:2\nBasic\tSpanish\tel gato\tthe cat<br>Mi gato&nbsp;duerme.\nCloze\tSpanish\tI {{c1::look::verb}} at {{c2::it}}\t";
  const list = readCardList(anki);
  assert.deepEqual(list.items.map((item) => [item.deck, item.fields.front, item.fields.back, item.fields.example, item.fields.cloze]), [
    ["Spanish", "el gato", ["the cat"], "Mi gato duerme.", false],
    ["Spanish", "I {{look}} at {{it}}", [], "", true]
  ]);
});

test("Quizlet's export and a list with dashes", () => {
  assert.deepEqual(cards("kot\tcat\npies\tdog"), [["kot", "cat", ""], ["pies", "dog", ""]]);
  assert.equal(readCardList("apple - jabłko\npear – gruszka").format, "dashes");
  assert.deepEqual(cards("apple - jabłko\npear – gruszka"), [["apple", "jabłko", ""], ["pear", "gruszka", ""]]);
});

test("#deck and #direction lines put the cards that follow into a deck", () => {
  const list = readCardList("#deck:One\na = b\n#deck:Two\n#direction:both\nc = d");
  assert.deepEqual(list.items.map((item) => [item.deck, item.direction, item.fields.front]), [
    ["One", null, "a"],
    ["Two", "both", "c"]
  ]);
});

test("text in a column that isn't read is counted, never dropped silently", () => {
  const list = readCardList("gato\tcat\tex\textra\nperro\tdog\t\t");
  assert.deepEqual(list.ignored, [1]);
});

test("a separator can be forced: --separator pipe", () => {
  assert.deepEqual(cards("gato|cat\nperro|dog", { separator: "pipe" }), [["gato", "cat", ""], ["perro", "dog", ""]]);
});

test("splitRows: quoted cells keep separators and line breaks; the row's first line is kept", () => {
  assert.deepEqual(splitRows(['a,"b,c"', '"d', 'e",f'], ","), [
    { line: 1, cells: ["a", "b,c"], comment: false },
    { line: 2, cells: ["d\ne", "f"], comment: false }
  ]);
});

test("a header row needs a front and a back column: \"Wort,word\" is a card", () => {
  assert.deepEqual(cards("Wort,word\nHund,dog"), [["Wort", "word", ""], ["Hund", "dog", ""]]);
  assert.deepEqual(cards("Wort;Übersetzung\nHund;dog", { csv: true }), [["Hund", "dog", ""]]);
});

test("a comment row is a whole line: its quotes don't swallow the rows below", () => {
  assert.deepEqual(cards('kon,horse\n# note, "careful\nmysz,mouse', { csv: true }), [["kon", "horse", ""], ["mysz", "mouse", ""]]);
});

test("a pasted list (comments: false) reads every line as a card", () => {
  assert.deepEqual(cards("#tag = hashtag\n#x\ty", { comments: false }), [["#tag", "hashtag", ""], ["#x", "y", ""]]);
});

test("in a table, \\; keeps a semicolon inside an answer; other braces in an Anki cloze stay text", () => {
  assert.deepEqual(cards("a\tx\\; y; z\nb\tc")[0], ["a", "x; y|z", ""]);
  assert.equal(readCardList("{{lit}} and {{c1::gap}}\tback\nb\tc").items[0].fields.front, "\\{{lit}} and {{gap}}");
});

test("a bulleted list loses its bullets", () => {
  assert.deepEqual(cards("- dom - house\n- kot - cat"), [["dom", "house", ""], ["kot", "cat", ""]]);
  assert.deepEqual(cards("• dom = house\n• kot = cat"), [["dom", "house", ""], ["kot", "cat", ""]]);
});

test("Anki's editor HTML: an opening <div> starts a new line too", () => {
  assert.deepEqual(cards("#separator:tab\n#html:true\nquerer\tto want; to love<div>Te quiero.</div>"), [["querer", "to want|to love", "Te quiero."]]);
});

test("in an Anki file only {{c1::…}} is a gap: other braces stay text", () => {
  const [card] = readCardList("#separator:tab\n#html:true\nplain {{x}} braces\ty").items;
  assert.deepEqual([card.fields.front, card.fields.cloze], ["plain {{x}} braces", false]);
});

test("a cloze note from Anki in another language is still a cloze, its Extra field an example", () => {
  const anki = "#separator:tab\n#html:true\n#notetype column:1\n#deck column:2\nLuka\tSpanish\tYo {{c1::tengo}} {{c2::dos}} perros.\tI have two dogs.\nLückentext\tSpanish\tElla {{c1::come}} pan.\tverb\\; food<br>She eats bread.\nPodstawowy\tSpanish\tplain {{x}}\ty";
  assert.deepEqual(readCardList(anki).items.map(({ fields }) => [fields.front, fields.back, fields.example, fields.cloze]), [
    ["Yo {{tengo}} {{dos}} perros.", [], "I have two dogs.", true],
    ["Ella {{come}} pan.", ["verb; food"], "She eats bread.", true],
    ["plain {{x}}", ["y"], "", false]
  ]);
});

test("#direction belongs to its deck, and one that isn't a direction is said", () => {
  const list = readCardList("#deck:A\n#direction:backward\na = b\n#deck:B\nc = d\n#direction: both ways\ne = f");
  assert.deepEqual(list.items.map((item) => [item.deck, item.direction]), [["A", "backward"], ["B", null], ["B", null]]);
  assert.deepEqual(list.unknown, [{ line: 6, text: "#direction:both ways" }]);
});

test("a numbered list loses its numbers", () => {
  assert.deepEqual(cards("1. hablar = to speak\n2) comer = to eat"), [["hablar", "to speak", ""], ["comer", "to eat", ""]]);
});

test("a cell that only starts with a quote is plain text, not a quoted cell", () => {
  assert.deepEqual(cards("\"Quote me' she said\tcytat\nkot\tkotek\npies\tdog"), [["\"Quote me' she said", "cytat", ""], ["kot", "kotek", ""], ["pies", "dog", ""]]);
  assert.deepEqual(cards("\"to be\" or not\tbyć\nkot\tkotek"), [["\"to be\" or not", "być", ""], ["kot", "kotek", ""]]);
  assert.deepEqual(cards('"a, b",c\n"d ""e""",f', { csv: true }), [["a, b", "c", ""], ['d "e"', "f", ""]]);
});
