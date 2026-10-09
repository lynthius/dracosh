import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, parseNotes } from "../src/parse.js";

test("parses a translate card made by the Mac app", () => {
  const note = {
    noteId: 1,
    front: "genuine",
    back: '<span style="color:#888;">autentyczny, szczery, prawdziwy</span><div style="font-style:italic;color:#aaa;margin-top:6px;">"Her apology felt completely genuine."</div>'
  };
  assert.deepEqual(parseNote(note), {
    noteId: 1,
    word: "genuine",
    translations: ["autentyczny", "szczery", "prawdziwy"],
    example: "Her apology felt completely genuine."
  });
});

test("parses an older plain card", () => {
  const parsed = parseNote({ noteId: 2, front: "same", back: 'taki sam, ten sam, sam<br>"We have the same car."' });
  assert.deepEqual(parsed.translations, ["taki sam", "ten sam", "sam"]);
  assert.equal(parsed.example, "We have the same car.");
});

test("decodes entities and skips define cards", () => {
  assert.equal(parseNote({ noteId: 3, front: "R&amp;D", back: "badania i rozw&oacute;j" }).word, "R&D");
  const define = {
    noteId: 4,
    front: "bloat",
    back: '<div style="font-size:0.7em;letter-spacing:0.08em;text-transform:uppercase;color:#888;">software</div><div style="margin-top:6px;">Needless extra features.</div>'
  };
  assert.equal(parseNote(define), null);
  assert.equal(parseNotes([define]).skipped, 1);
});
