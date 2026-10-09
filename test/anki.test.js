import assert from "node:assert/strict";
import { test } from "node:test";
import { toFrontBack } from "../src/anki.js";

test("takes the first two fields by position, whatever they're called", () => {
  const english = { noteId: 1, fields: { Back: { value: "kot", order: 1 }, Front: { value: "cat", order: 0 } } };
  const polish = { noteId: 2, fields: { Przód: { value: "dog", order: 0 }, Tył: { value: "pies", order: 1 } } };
  const german = { noteId: 3, fields: { Vorderseite: { value: "house", order: 0 }, Rückseite: { value: "dom", order: 1 }, Extra: { value: "", order: 2 } } };
  assert.deepEqual(toFrontBack(english), { noteId: 1, front: "cat", back: "kot" });
  assert.deepEqual(toFrontBack(polish), { noteId: 2, front: "dog", back: "pies" });
  assert.deepEqual(toFrontBack(german), { noteId: 3, front: "house", back: "dom" });
});

test("skips notes with fewer than two fields", () => {
  assert.equal(toFrontBack({ noteId: 4, fields: { Text: { value: "cloze", order: 0 } } }), null);
  assert.equal(toFrontBack({ noteId: 5 }), null);
});
