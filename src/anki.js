// Read-only AnkiConnect client: the quiz never writes to Anki.
const ANKI_URL = process.env.ANKI_CONNECT_URL || "http://localhost:8765";

async function invoke(action, params = {}) {
  let res;
  try {
    res = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new Error("Can't reach Anki. Make sure Anki is running with AnkiConnect.");
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

const escapeQuery = (s) => s.replace(/[\\"]/g, "\\$&");

export async function fetchNotes(deck) {
  const ids = await invoke("findNotes", { query: `deck:"${escapeQuery(deck)}"` });
  if (!ids.length) return [];
  const infos = await invoke("notesInfo", { notes: ids });
  return infos.map(toFrontBack).filter(Boolean);
}

// The first two fields of a note, by position: field names depend on the note type and on
// Anki's UI language ("Front"/"Back", "Przód"/"Tył", "Vorderseite"/"Rückseite"…).
export function toFrontBack(info) {
  const fields = Object.values(info.fields ?? {}).sort((a, b) => a.order - b.order);
  if (fields.length < 2) return null;
  return { noteId: info.noteId, front: fields[0].value, back: fields[1].value };
}
