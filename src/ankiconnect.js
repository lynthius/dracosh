import { request } from "node:http";

// Talking to a running Anki through the AnkiConnect add-on (code 2055492159): JSON over HTTP on
// 127.0.0.1:8765, API version 6. Cards move as Anki's own packages, made and read by Anki itself
// (exportPackage, importPackage), so they go the same tested way as an .apkg file.
// DRACOSH_ANKI_URL points elsewhere; DRACOSH_ANKI_KEY is the key, when AnkiConnect is set to ask one.
//   const anki = connect(); await anki("deckNames") → ["Default", "Spanish", …]

const API_VERSION = 6;
const TIMEOUT = 5 * 60_000; // Anki writes or reads a big collection for a while

// → an error with a code: NO_ANKI (nothing answers), OLD_ANKICONNECT, ANKI_KEY, or ANKI_ERROR (Anki
// said no; its words in `detail`)
const failure = (code, detail = "") => Object.assign(new Error(`AnkiConnect: ${code} ${detail}`.trim()), { code, detail });

export function connect({ url = process.env.DRACOSH_ANKI_URL || "http://127.0.0.1:8765", key = process.env.DRACOSH_ANKI_KEY || null } = {}) {
  const call = (action, params = {}) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ action, version: API_VERSION, params, ...(key && { key }) });
      // node:http sends no Origin header, which AnkiConnect lets through without asking
      // a connection of its own each time (agent: false), closed when answered, so nothing is left
      // open to keep Dracosh from exiting
      const req = request(url, { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: TIMEOUT }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          let reply;
          try {
            reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reject(failure("NO_ANKI", "the answer isn't AnkiConnect's"));
          }
          if (reply === null || typeof reply !== "object" || !("result" in reply)) return reject(failure("OLD_ANKICONNECT"));
          if (reply.error) return reject(/api key/i.test(reply.error) ? failure("ANKI_KEY") : failure("ANKI_ERROR", String(reply.error)));
          resolve(reply.result);
        });
      });
      req.on("timeout", () => req.destroy(failure("NO_ANKI", "no answer in time")));
      req.on("error", (err) => reject(err.code === "NO_ANKI" ? err : failure("NO_ANKI", err.code ?? err.message)));
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

// Anki's decks → [{ name, notes, filtered }], by name: `notes` counts its subdecks' too, and those
// with cards lent to a filtered deck for now (one Anki note is one Dracosh card); a `filtered` deck
// only borrows cards (its config says "dyn")
export async function ankiDecks(anki) {
  const names = (await anki("deckNames")).sort((a, b) => a.localeCompare(b));
  // in Anki's search "*" and "_" are wildcards: escaped, they're the name's own characters
  const query = (name) => `deck:"${name.replace(/(["\\*_])/g, "\\$1")}"`;
  const replies = await anki("multi", { actions: names.flatMap((name) => [anki.action("findNotes", { query: query(name) }), anki.action("getDeckConfig", { deck: name })]) });
  const result = (reply) => {
    if (reply?.error) throw /api key/i.test(reply.error) ? failure("ANKI_KEY") : failure("ANKI_ERROR", String(reply.error));
    return reply && typeof reply === "object" && "result" in reply ? reply.result : reply;
  };
  return names.map((name, i) => ({ name, notes: result(replies[2 * i])?.length ?? 0, filtered: Boolean(result(replies[2 * i + 1])?.dyn) }));
}

// a deck as an .apkg written by Anki at `path` (AnkiConnect's exportPackage, subdecks included).
// With scheduling, so a card lent to a filtered deck still says which deck is its own.
export async function exportDeck(anki, deck, path) {
  if (!(await anki("exportPackage", { deck, path, includeSched: true }))) throw failure("ANKI_ERROR", `no deck "${deck}"`);
}

// an .apkg at `path` imported by Anki, as File → Import does (notes it has already, newer here,
// are updated)
export async function importIntoAnki(anki, path) {
  if (!(await anki("importPackage", { path }))) throw failure("ANKI_ERROR", "nothing imported");
}
