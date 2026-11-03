import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
process.env.FORCE_COLOR = "0";
delete process.env.ELEVENLABS_API_KEY;
// nothing plays: fake afplay and say that only note what they were asked
const bin = mkdtempSync(join(tmpdir(), "dracosh-bin-"));
const played = join(bin, "played.log");
// say lists one Polish voice for `-v ?`, and writes an empty file for `-o`
writeFileSync(join(bin, "afplay"), `#!/bin/sh\necho "afplay $*" >> "${played}"\n`);
writeFileSync(join(bin, "say"), `#!/bin/sh\nif [ "$2" = "?" ]; then echo "Zosia               pl_PL    # Witaj"; exit 0; fi\necho "say $*" >> "${played}"\n: > "$4"\n`);
for (const name of ["afplay", "say"]) chmodSync(join(bin, name), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const { default: React } = await import("react");
const { render } = await import("ink");
const { setLanguage } = await import("../src/i18n.js");
const { audioPath, AUDIO_DIR, findVoiceKey, listVoices, MODEL, normalizeVoice, speaksLanguage, speech, voiceLabel } = await import("../src/voice.js");
const { findKey, saveKey, forgetKey } = await import("../src/ai.js");
const { DATA_FILES } = await import("../src/store.js");
const { normalizeSettings } = await import("../src/settings.js");
const { createAlerts } = await import("../src/alerts.js");
const { VoiceSetup } = await import("../src/ui/Voice.js");
setLanguage("en");

// a stand-in for ElevenLabs: two pages of voices and an mp3 for any text; `reply` overrides one answer
let server;
let base;
let seen = [];
let reply = null;
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const send = (status, data) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(data)));
      if (reply) return send(...reply);
      if (req.url.startsWith("/v2/voices")) {
        const second = req.url.includes("next_page_token=p2");
        return send(200, second
          ? { voices: [{ voice_id: "v2", name: "Bella", labels: { gender: "female", accent: "american" } }, { voice_id: "v1", name: "Adam" }], has_more: false, next_page_token: null }
          : { voices: [{ voice_id: "v3", name: "Charlie", labels: { gender: "male", age: "young" } }, { voice_id: "v1", name: "Adam" }, { name: "no id" }], has_more: true, next_page_token: "p2" });
      }
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        return res.end(Buffer.from("ID3 fake mp3"));
      }
      send(404, { detail: { code: "not_found", message: "no route" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const fresh = () => ((seen = []), (reply = null));
const voice = () => ({ provider: "elevenlabs", id: "v1", name: "Adam", url: base });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (text) => text.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "");

test("the voice setting keeps a valid ElevenLabs voice and drops anything else", () => {
  assert.deepEqual(normalizeVoice({ provider: "elevenlabs", id: "abc_1", name: " Adam ", url: "https://api.eu.residency.elevenlabs.io/" }), { provider: "elevenlabs", id: "abc_1", name: "Adam", url: "https://api.eu.residency.elevenlabs.io" });
  assert.deepEqual(normalizeVoice({ provider: "elevenlabs", id: "abc" }), { provider: "elevenlabs", id: "abc", name: "abc" });
  for (const bad of [null, "x", {}, { provider: "openai", id: "a" }, { provider: "elevenlabs" }, { provider: "elevenlabs", id: "../x" }]) assert.equal(normalizeVoice(bad), null);
  // the key goes to the address: only ElevenLabs' own servers, over https
  for (const url of ["http://api.elevenlabs.io", "https://evil.example", "https://elevenlabs.io.evil.example", "https://api.elevenlabs.io/v1/../x"]) assert.equal(normalizeVoice({ provider: "elevenlabs", id: "a", url }).url, undefined, url);
  assert.equal(normalizeSettings({}).voice, null, "off unless chosen: the system's voices");
  assert.equal(normalizeSettings({ voice: { provider: "elevenlabs", id: "" } }).voice, null);
  assert.equal(voiceLabel(null), "macOS voices");
  assert.equal(voiceLabel(voice()), "ElevenLabs · Adam");
});

test("the languages the voice can read, Norwegian and Filipino by their other codes too", () => {
  for (const lang of ["en", "pl", "de", "fr", "uk", "ja", "no", "nb", "fil", "tl"]) assert.ok(speaksLanguage(lang), lang);
  for (const lang of ["la", "eo", "sw"]) assert.ok(!speaksLanguage(lang), lang);
});

test("voices come from every page with the key, once each, by name", async () => {
  fresh();
  const list = await listVoices({ key: "el-key-1", url: base });
  assert.deepEqual(list, [
    { id: "v1", name: "Adam", note: "" },
    { id: "v2", name: "Bella", note: "female, american" },
    { id: "v3", name: "Charlie", note: "male, young" }
  ]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].headers["xi-api-key"], "el-key-1");
  assert.match(seen[0].url, /^\/v2\/voices\?page_size=100$/);
  assert.match(seen[1].url, /next_page_token=p2/);
});

test("a word is made once, kept in the audio folder, and read from there after", async () => {
  fresh();
  const file = await speech(voice(), "kot", "pl", { key: "el-key-1" });
  assert.equal(file, audioPath(voice(), "kot", "pl"));
  assert.ok(file.startsWith(AUDIO_DIR));
  assert.equal(readFileSync(file, "utf8"), "ID3 fake mp3");
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/v1/text-to-speech/v1?output_format=mp3_44100_64");
  assert.equal(request.headers["xi-api-key"], "el-key-1");
  assert.deepEqual(request.body, { text: "kot", model_id: MODEL, language_code: "pl" });

  assert.equal(await speech(voice(), "kot", "pl", { key: "el-key-1" }), file);
  assert.equal(seen.length, 1, "the kept file, no second request");
  await speech({ ...voice(), id: "v2" }, "kot", "pl", { key: "el-key-1" });
  await speech(voice(), "kot", "nb", { key: "el-key-1" });
  assert.equal(seen.length, 3, "another voice or language is another file");
  assert.equal(seen[2].body.language_code, "no");
  assert.ok(!readdirSync(AUDIO_DIR).some((name) => name.endsWith(".tmp")));
});

test("what went wrong is said plainly, and the key is never part of it", async () => {
  const cases = [
    [[401, { detail: { type: "authentication_error", code: "invalid_api_key", message: "Invalid key el-secret" } }], "badKey"],
    [[402, { detail: { type: "payment_required", code: "insufficient_credits" } }], "noCredit"],
    [[401, { detail: { status: "quota_exceeded", message: "quota" } }], "noCredit"],
    [[404, { detail: { code: "voice_not_found" } }], "noVoice"],
    [[429, { detail: { code: "concurrent_limit_exceeded" } }], "rateLimit"],
    [[503, { detail: { code: "maintenance" } }], "server"],
    [[400, { detail: { code: "invalid_parameters", message: "bad text from el-secret" } }], "failed"]
  ];
  for (const [answer, code] of cases) {
    fresh();
    reply = answer;
    await assert.rejects(speech(voice(), `word ${code} ${answer[0]}`, "en", { key: "el-secret" }), (err) => {
      assert.equal(err.code, code);
      assert.doesNotMatch(err.message, /el-secret/);
      return true;
    });
  }
  fresh();
  await assert.rejects(speech(voice(), "no key", "en", { key: null }), { code: "noKey" });
  assert.equal(seen.length, 0, "no request without a key");
  await assert.rejects(speech({ ...voice(), url: "http://127.0.0.1:9" }, "offline", "en", { key: "k" }), { code: "offline" });
});

test("the key: from ELEVENLABS_API_KEY first, else saved apart from the data, never in backups", async () => {
  assert.equal(await findVoiceKey(), null);
  await saveKey("elevenlabs", " el-saved ");
  assert.deepEqual(await findVoiceKey(), { key: "el-saved", from: "saved" });
  process.env.ELEVENLABS_API_KEY = "el-env";
  try {
    assert.deepEqual(await findKey("elevenlabs"), { key: "el-env", from: "env", env: "ELEVENLABS_API_KEY" });
  } finally {
    delete process.env.ELEVENLABS_API_KEY;
  }
  await forgetKey("elevenlabs");
  assert.equal(await findVoiceKey(), null);
  assert.ok(!Object.values(DATA_FILES).some((file) => /keys\.json|audio/.test(file)), "keys and audio stay out of backups");
});

const darwin = process.platform === "darwin";
const playedLines = () => (existsSync(played) ? readFileSync(played, "utf8").trim().split("\n").filter(Boolean) : []);
// until `done()` holds, or a few seconds pass
const until = async (done) => {
  for (let i = 0; i < 60 && !done(); i++) await wait(50);
};

test("a word read aloud plays the natural voice's file, made once", { skip: !darwin && "afplay is macOS only" }, async () => {
  fresh();
  writeFileSync(played, "");
  const alerts = createAlerts({ speak: true, voice: voice() });
  await saveKey("elevenlabs", "el-saved");
  await alerts.speak("pies", "pl");
  await until(() => playedLines().length);
  assert.deepEqual(playedLines(), [`afplay -v 0.5 ${audioPath(voice(), "pies", "pl")}`]);
  assert.equal(seen.length, 1);
  await alerts.speak("pies", "pl");
  await until(() => playedLines().length > 1);
  assert.equal(playedLines().length, 2);
  assert.equal(seen.length, 1, "the second time, from the kept file");
  await forgetKey("elevenlabs");
});

test("a language the voice can't read, or no voice set, stays with macOS voices", { skip: !darwin && "say is macOS only" }, async () => {
  fresh();
  writeFileSync(played, "");
  const alerts = createAlerts({ speak: true, voice: voice() });
  await alerts.speak("salve", "la");
  await wait(700);
  assert.equal(seen.length, 0, "Latin isn't sent to ElevenLabs");
  alerts.configure({ voice: null });
  await alerts.speak("pies", "pl");
  await until(() => playedLines().some((line) => line.startsWith("say ")));
  assert.equal(seen.length, 0);
  assert.ok(playedLines().some((line) => line.startsWith("say ")), "read by the system's voice");
});

test("a voice that stops working says so once, and the words go on in the system's voice", { skip: !darwin && "say is macOS only" }, async () => {
  fresh();
  writeFileSync(played, "");
  const problems = [];
  const alerts = createAlerts({ speak: true, voice: voice(), onVoiceProblem: (message) => problems.push(message) });
  await saveKey("elevenlabs", "el-bad");
  reply = [401, { detail: { code: "invalid_api_key" } }];
  await alerts.speak("koń", "pl");
  await alerts.speak("krowa", "pl");
  await until(() => playedLines().some((line) => line.startsWith("say ")));
  assert.equal(seen.length, 1, "not asked again after the key failed");
  assert.ok(playedLines().some((line) => line.startsWith("say ")), "read by the system's voice instead");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /didn't accept the key/);
  // a word made before still plays from its file, with no request
  writeFileSync(played, "");
  await alerts.speak("pies", "pl");
  await until(() => playedLines().length);
  assert.deepEqual(playedLines(), [`afplay -v 0.5 ${audioPath(voice(), "pies", "pl")}`]);
  assert.equal(seen.length, 1);
  // the same voice picked again in /settings (with a new key, say) is tried again
  alerts.configure({ voice: voice() });
  reply = null;
  await alerts.speak("mysz", "pl");
  assert.equal(seen.length, 2);
  alerts.configure({ speak: false });
  await forgetKey("elevenlabs");
});

test("switching pronunciation off cancels a word still on its way", { skip: !darwin && "afplay is macOS only" }, async () => {
  fresh();
  writeFileSync(played, "");
  const alerts = createAlerts({ speak: true, voice: voice() });
  await saveKey("elevenlabs", "el-saved");
  const going = alerts.speak("ryba", "pl");
  alerts.configure({ speak: false });
  await going;
  await wait(700);
  assert.deepEqual(playedLines(), []);
  await forgetKey("elevenlabs");
});

// /settings → Voice, with stdin and stdout faked
async function openSetup(props = {}) {
  const saved = [];
  const closed = [];
  const plays = [];
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 30, isTTY: true });
  let output = "";
  stdout.on("data", (chunk) => plain(String(chunk)).trim() && (output = String(chunk)));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {}, setEncoding() {} });
  const app = render(React.createElement(VoiceSetup, { current: voice(), onSave: (v) => saved.push(v), onClose: (said) => closed.push(said), play: (file) => plays.push(file), ...props }), { stdout, stdin, debug: true, patchConsole: false });
  await wait(400);
  return { type: async (text, ms = 80) => (stdin.write(text), await wait(ms)), screen: () => plain(output), saved, closed, plays, close: () => app.unmount() };
}

test("picking ElevenLabs: the key, a voice, a sample heard, then saved", async () => {
  fresh();
  await forgetKey("elevenlabs");
  const setup = await openSetup();
  assert.match(setup.screen(), /Now: ElevenLabs · Adam/);
  await setup.type("2", 150);
  assert.match(setup.screen(), /ElevenLabs key/);
  await setup.type("el-typed");
  await setup.type("\r", 300);
  assert.match(setup.screen(), /Pick a voice/);
  assert.match(setup.screen(), /Adam · current/);
  assert.match(setup.screen(), /Bella · female, american/);
  await setup.type("\x1b[B");
  await setup.type("\r", 300);
  assert.deepEqual(setup.saved, [{ provider: "elevenlabs", id: "v2", name: "Bella", url: base }]);
  assert.match(setup.closed[0], /^Words are read by ElevenLabs · Bella/);
  assert.equal(setup.plays.length, 1);
  assert.equal(seen.at(-1).body.text, "Hello! I'll read your words aloud.");
  assert.deepEqual(await findVoiceKey(), { key: "el-typed", from: "saved" }, "the typed key is kept once it worked");
  setup.close();
  await forgetKey("elevenlabs");
});

test("picking a voice with Read aloud off says it's on now", async () => {
  fresh();
  await saveKey("elevenlabs", "el-saved");
  const setup = await openSetup({ speakOn: false });
  await setup.type("2", 400);
  await setup.type("\r", 400); // keep the saved key
  await setup.type("\r", 400); // Adam
  assert.match(setup.closed[0], /^Read aloud is on: words are read by ElevenLabs · Adam/);
  setup.close();
  await forgetKey("elevenlabs");
});

test("a key ElevenLabs refuses goes back to the key, and nothing is saved", async () => {
  fresh();
  const setup = await openSetup();
  await setup.type("2", 150);
  reply = [401, { detail: { code: "invalid_api_key" } }];
  await setup.type("el-wrong");
  await setup.type("\r", 300);
  assert.match(setup.screen(), /ElevenLabs key/);
  assert.match(setup.screen(), /ElevenLabs didn't accept the key\.\s/);
  assert.doesNotMatch(setup.screen(), /settings → Voice/, "no pointing to where you already are");
  assert.deepEqual(setup.saved, []);
  assert.equal(await findVoiceKey(), null);
  setup.close();
});

test("going back to macOS voices saves no voice", async () => {
  const setup = await openSetup();
  await setup.type("1", 150);
  assert.deepEqual(setup.saved, [null]);
  assert.match(setup.closed[0], /macOS voices again/);
  setup.close();
  const untouched = await openSetup({ current: null });
  await untouched.type("1", 150);
  assert.deepEqual(untouched.saved, [], "already the system's: nothing to change");
  untouched.close();
});
