import { request } from "node:http";

// Talking to a running Anki through the AnkiConnect add-on (code 2055492159): JSON over HTTP on
// 127.0.0.1:8765, API version 6. Cards move as Anki's own packages, made and read by Anki itself
// (exportPackage, importPackage), so they go the same tested way as an .apkg file.
// DRACOSH_ANKI_URL points elsewhere; DRACOSH_ANKI_KEY is the key, when AnkiConnect is set to ask one.
//   const anki = connect(); await anki("deckNames") → ["Default", "Spanish", …]

const API_VERSION = 6;
// AnkiConnect answers from Anki's main thread: a busy Anki (syncing, checking its database) or one
// macOS has put to sleep in the background (App Nap) takes the call and says nothing. A question
// waits this long; writing or reading a whole package (media too) may take minutes.
const QUICK = 15_000;
const SLOW = 10 * 60_000;
const SLOW_ACTIONS = new Set(["exportPackage", "importPackage"]);

// → an error with a code: NO_ANKI (nothing answers), ANKI_BUSY (it took the call, no answer),
// BAD_URL, OLD_ANKICONNECT, ANKI_KEY, NO_DECK, NOT_IMPORTED, or ANKI_ERROR (Anki said no; its words
// in `detail`)
const failure = (code, detail = "") => Object.assign(new Error(`AnkiConnect: ${code} ${detail}`.trim()), { code, detail });
// a reply of API version 6, { result, error } → its result, or the failure it says
const resultOf = (reply) => {
  if (reply === null || typeof reply !== "object" || !("result" in reply)) throw failure("OLD_ANKICONNECT");
  if (reply.error) throw /api key/i.test(reply.error) ? failure("ANKI_KEY") : failure("ANKI_ERROR", String(reply.error));
  return reply.result;
};

export function connect({ url = process.env.DRACOSH_ANKI_URL || "http://127.0.0.1:8765", key = process.env.DRACOSH_ANKI_KEY || null } = {}) {
  let target = null;
  try {
    target = new URL(url);
  } catch {}
  if (target?.protocol !== "http:") target = null;
  const call = (action, params = {}) =>
    new Promise((resolve, reject) => {
      if (!target) return reject(failure("BAD_URL", url));
      const body = JSON.stringify({ action, version: API_VERSION, params, ...(key && { key }) });
      // node:http sends no Origin header, which AnkiConnect lets through without asking; a
      // connection of its own each time (agent: false) is closed when answered, so nothing left
      // open keeps Dracosh from exiting
      const timeout = SLOW_ACTIONS.has(action) ? SLOW : QUICK;
      const req = request(target, { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(resultOf(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
          } catch (err) {
            reject(err.code ? err : failure("NO_ANKI", "the answer isn't AnkiConnect's"));
          }
        });
      });
      req.on("timeout", () => req.destroy(failure("ANKI_BUSY")));
      req.on("error", (err) => reject(err.code === "ANKI_BUSY" ? err : failure("NO_ANKI", err.code ?? err.message)));
      req.end(body);
    });

  let checked = null;
  // the first call checks that it's an AnkiConnect new enough for API version 6
  const anki = async (action, params) => {
    checked ??= call("version").then((version) => {
      if (!(Number(version) >= API_VERSION)) throw failure("OLD_ANKICONNECT");
    });
    await checked;
    return call(action, params);
  };
  // the actions in a "multi" are each checked like a request of their own: version and key too
  anki.action = (action, params) => ({ action, version: API_VERSION, params, ...(key && { key }) });
  return anki;
}

// "Spanish" before "Spanish Extra", with "Spanish::Verbs" right under its parent
const byName = (a, b) => {
  const [left, right] = [a.split("::"), b.split("::")];
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i].localeCompare(right[i]);
  return left.length - right.length;
};

// Anki's decks → [{ name, notes, filtered }]: `notes` counts its subdecks' too, and those with cards
// lent to a filtered deck for now (one Anki note is one Dracosh card); a `filtered` deck only borrows
// cards (its config says "dyn")
export async function ankiDecks(anki) {
  const names = (await anki("deckNames")).sort(byName);
  // in Anki's search "*" and "_" are wildcards: escaped, they're the name's own characters
  const query = (name) => `deck:"${name.replace(/(["\\*_])/g, "\\$1")}"`;
  const replies = await anki("multi", { actions: names.flatMap((name) => [anki.action("findNotes", { query: query(name) }), anki.action("getDeckConfig", { deck: name })]) });
  return names.map((name, i) => ({ name, notes: resultOf(replies[2 * i])?.length ?? 0, filtered: Boolean(resultOf(replies[2 * i + 1])?.dyn) }));
}

// a deck as an .apkg written by Anki at `path` (AnkiConnect's exportPackage, subdecks included).
// With scheduling, so a card lent to a filtered deck still says which deck is its own.
export async function exportDeck(anki, deck, path) {
  if (!(await anki("exportPackage", { deck, path, includeSched: true }))) throw failure("NO_DECK", deck);
}

// the name and fields of the note type with that id in Anki, or null when there's none
export async function noteType(anki, id) {
  const name = Object.entries(await anki("modelNamesAndIds")).find(([, each]) => Number(each) === id)?.[0];
  return name === undefined ? null : { name, fields: await anki("modelFieldNames", { modelName: name }) };
}

// an .apkg at `path` imported by Anki, as File → Import does (notes it has already, newer here,
// are updated)
export async function importIntoAnki(anki, path) {
  if (!(await anki("importPackage", { path }))) throw failure("NOT_IMPORTED");
}
