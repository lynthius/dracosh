// Read-only AnkiConnect client: the quiz never writes to Anki.
const ANKI_URL = process.env.ANKI_CONNECT_URL || "http://localhost:8765";
const FRONT = "Przód";
const BACK = "Tył";

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
  return infos
    .filter((info) => info.fields?.[FRONT] && info.fields?.[BACK])
    .map((info) => ({
      noteId: info.noteId,
      front: info.fields[FRONT].value,
      back: info.fields[BACK].value
    }));
}
