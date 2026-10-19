import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readApkg } from "../src/apkg.js";

// AnkiConnect as Dracosh sees it: JSON over HTTP, { result, error }. Its packages are the test
// fixtures Anki made (test/fixtures/make-anki-fixtures.py), so what comes back is Anki's own.
const FIXTURE = new URL("./fixtures/anki-modern.apkg", import.meta.url).pathname;
const servers = [];
after(() => servers.forEach((server) => server.close()));
function fakeAnki({ key = null, version = 6, filtered = false } = {}) {
  const calls = [];
  const imported = [];
  const actions = {
    version: () => version,
    deckNames: () => ["Default", "Spanish", "Spanish::Both ways", ...(filtered ? ["Cram"] : [])],
    findNotes: ({ query }) => ({ 'deck:"Default"': [], 'deck:"Spanish"': [1, 2, 3], 'deck:"Spanish::Both ways"': [2], 'deck:"Cram"': [4] })[query] ?? [],
    getDeckConfig: ({ deck }) => ({ id: 1, dyn: deck === "Cram" ? 1 : false }),
    multi: ({ actions: list }) => list.map((each) => (assert.equal(each.version, 6), reply(each))),
    exportPackage: ({ deck, path }) => {
      if (!["Spanish", "Spanish::Both ways", "Cram"].includes(deck)) return false;
      copyFileSync(FIXTURE, path);
      return true;
    },
    importPackage: async ({ path }) => {
      imported.push(await readApkg(path));
      return true;
    }
  };
  const reply = async (request) => {
    calls.push(request.action);
    if (key && request.key !== key) return { result: null, error: "valid api key must be provided" };
    const action = actions[request.action];
    if (!action) return { result: null, error: "unsupported action" };
    const result = await action(request.params ?? {});
    return { result: Array.isArray(result) ? await Promise.all(result) : result, error: null };
  };
  const server = createServer((req, res) => {
    req.setTimeout(10_000);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      assert.equal(req.headers.origin, undefined, "no Origin header, so AnkiConnect never asks for permission");
      res.end(JSON.stringify(await reply(JSON.parse(Buffer.concat(chunks).toString()))));
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, imported, close: () => server.close() })));
}

const CLI = new URL("../src/cli.js", import.meta.url).pathname;
// async, so the fake Anki in this process can answer
const run = (home, args, env = {}, input = "") =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, DRACOSH_HOME: home, LC_ALL: "", LC_MESSAGES: "", LANG: "en_US.UTF-8", ...env } });
    let [stdout, stderr] = ["", ""];
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.end(input);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
const home = () => mkdtempSync(join(tmpdir(), "dracosh-"));
const library = (dir) => JSON.parse(readFileSync(join(dir, "library.json"), "utf8"));

test("dracosh import --anki \"Spanish\": the deck as Anki writes it, through the same preview as a package", async () => {
  const anki = await fakeAnki();
  const dir = home();
  const preview = await run(dir, ["import", "--anki", "spanish"], { DRACOSH_ANKI_URL: anki.url });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Getting Spanish from Anki…\nFrom Anki: Spanish\n/);
  assert.match(preview.stdout, /To import: dracosh import --anki "spanish" --yes/);
  const done = await run(dir, ["import", "--anki", "Spanish", "--yes"], { DRACOSH_ANKI_URL: anki.url });
  assert.equal(done.status, 0, done.stderr);
  assert.ok(library(dir).cards.some((card) => card.front === "el gato"));
  assert.ok(anki.calls.includes("exportPackage"));
  anki.close();
});

test("without a deck it's all of them; a subdeck of one taken isn't asked for twice, a filtered one never", async () => {
  const anki = await fakeAnki({ filtered: true });
  const result = await run(home(), ["import", "--anki"], { DRACOSH_ANKI_URL: anki.url });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Getting Spanish from Anki…\nFrom Anki: Spanish\n/);
  anki.close();
});

test("dracosh export --anki: one package into Anki, asked first, never with a file, never Anki's own notes back", async () => {
  const anki = await fakeAnki();
  const dir = home();
  const env = { DRACOSH_ANKI_URL: anki.url };
  assert.equal((await run(dir, ["import", "-", "--deck", "Italian", "--yes"], env, "il gatto = the cat\nla casa = the house\n")).status, 0);
  assert.equal((await run(dir, ["import", "--anki", "Spanish", "--yes"], env)).status, 0);
  assert.match((await run(dir, ["export", "--anki"], env)).stderr, /add --yes/);
  assert.match((await run(dir, ["export", "--anki", "x.apkg"], env)).stderr, /without a file/);
  const sent = await run(dir, ["export", "--anki", "--yes"], env);
  assert.equal(sent.status, 0, sent.stderr);
  assert.match(sent.stdout, /\d+ cards came from Anki and stay out: Anki has them already\.\nSent to Anki: 2 cards \(Italian\)/);
  assert.equal(anki.imported.length, 1);
  assert.deepEqual(anki.imported[0].items.map((item) => item.deck), ["Italian", "Italian"]);
  assert.match((await run(dir, ["export", "--anki", "--deck", "Spanish", "--yes"], env)).stderr, /Nothing to send: these cards all came from Anki/);
  const file = join(dir, "..", `${dir.split("/").pop()}.apkg`);
  assert.match((await run(dir, ["export", file])).stdout, /came from Anki: imported into that same Anki, they're a second copy/);
  anki.close();
});

test("no Anki, an old AnkiConnect, a key it asks for: each said plainly", async () => {
  const dir = home();
  assert.match((await run(dir, ["import", "--anki"], { DRACOSH_ANKI_URL: "http://127.0.0.1:9" })).stderr, /Anki isn't answering\. Open Anki with the AnkiConnect add-on/);
  const old = await fakeAnki({ version: 5 });
  assert.match((await run(dir, ["import", "--anki"], { DRACOSH_ANKI_URL: old.url })).stderr, /too old/);
  old.close();
  const locked = await fakeAnki({ key: "secret" });
  assert.match((await run(dir, ["import", "--anki"], { DRACOSH_ANKI_URL: locked.url })).stderr, /DRACOSH_ANKI_KEY/);
  const unlocked = await run(dir, ["import", "--anki", "--yes"], { DRACOSH_ANKI_URL: locked.url, DRACOSH_ANKI_KEY: "secret" });
  assert.equal(unlocked.status, 0, unlocked.stderr);
  assert.match((await run(dir, ["import", "--anki", "Nope"], { DRACOSH_ANKI_URL: locked.url, DRACOSH_ANKI_KEY: "secret" })).stderr, /Anki has no deck "Nope" with cards\. Its decks: Spanish, Spanish::Both ways/);
  locked.close();
});
