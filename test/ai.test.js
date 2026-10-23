import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

process.env.DRACOSH_HOME = mkdtempSync(join(tmpdir(), "dracosh-"));
for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "DRACOSH_AI_KEY"]) delete process.env[name];
const { ask, checkAi, stream, findKey, forgetKey, listModels, maskKey, normalizeAi, saveKey } = await import("../src/ai.js");
const { DATA_FILES } = await import("../src/store.js");
const { normalizeSettings } = await import("../src/settings.js");

// a stand-in for both APIs: answers by path, remembers what it was sent; `reply` overrides one answer
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
      const send = (status, data) => (res.writeHead(status, { "content-type": "application/json" }), res.end(typeof data === "string" ? data : JSON.stringify(data)));
      if (reply) return send(...reply);
      const asked = body ? JSON.parse(body) : {};
      if (asked.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const events = req.url === "/v1/messages"
          ? [{ type: "message_start" }, { type: "content_block_delta", delta: { type: "text_delta", text: "ko" } }, { type: "ping" }, { type: "content_block_delta", delta: { type: "text_delta", text: "t\npies" } }]
          : [{ choices: [{ delta: { role: "assistant" } }] }, { choices: [{ delta: { content: "ko" } }] }, { choices: [{ delta: { content: "t\npies" } }] }];
        // split mid-event, the way a network may cut it
        const raw = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + (req.url === "/v1/messages" ? "" : "data: [DONE]\n\n");
        res.write(raw.slice(0, 37));
        return setTimeout(() => res.end(raw.slice(37)), 20);
      }
      if (req.url.startsWith("/v1/models")) return send(200, { data: [{ id: "small" }, { id: "big" }, { id: "small" }, { id: "text-embedding-3-small" }, { id: "tts-1" }] });
      if (req.url === "/v1/messages") return send(200, { content: [{ type: "text", text: " kot " }] });
      if (req.url === "/v1/chat/completions") return send(200, { choices: [{ message: { content: "cat\n" } }] });
      send(404, { error: { message: "no route" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());
const fresh = () => ((seen = []), (reply = null));

test("an Anthropic request carries the key and the version, and gives back the text", async () => {
  fresh();
  const text = await ask({ provider: "anthropic", model: "claude-haiku-5-5", url: base }, { key: "sk-ant-1", system: "Translate.", prompt: "cat" });
  assert.equal(text, "kot");
  const [request] = seen;
  assert.equal(request.url, "/v1/messages");
  assert.equal(request.headers["x-api-key"], "sk-ant-1");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(request.body, { model: "claude-haiku-5-5", max_tokens: 400, system: "Translate.", messages: [{ role: "user", content: "cat" }] });
});

test("an OpenAI-compatible request sends the system message first; a local server gets no key", async () => {
  fresh();
  assert.equal(await ask({ provider: "ollama", model: "llama3.2", url: base }, { system: "Translate.", prompt: "kot", maxTokens: 50 }), "cat");
  const [request] = seen;
  assert.equal(request.headers.authorization, undefined);
  assert.deepEqual(request.body, { model: "llama3.2", max_tokens: 50, messages: [{ role: "system", content: "Translate." }, { role: "user", content: "kot" }] });
});

test("OpenAI itself is sent max_completion_tokens and a bearer key", async () => {
  fresh();
  await ask({ provider: "openai", model: "m", url: base }, { key: "sk-o", system: "s", prompt: "p", maxTokens: 20 });
  assert.equal(seen[0].headers.authorization, "Bearer sk-o");
  assert.equal(seen[0].body.max_completion_tokens, 20);
  assert.equal(seen[0].body.max_tokens, undefined);
});

test("models are listed by name, sorted, without repeats or the ones that don't write text", async () => {
  fresh();
  assert.deepEqual(await listModels({ provider: "lmstudio", url: base }), ["big", "small"]);
  assert.deepEqual(await listModels({ provider: "anthropic", url: base }, { key: "k" }), ["big", "small"]);
  assert.match(seen[1].url, /^\/v1\/models\?limit=/);
});

test("failures are told by what to do about them, never with the key", async () => {
  const ai = { provider: "openrouter", model: "x", url: base };
  const codeOf = async (status, data) => {
    fresh();
    reply = [status, data];
    return ask(ai, { key: "sk-secret-123", system: "s", prompt: "p" }).then(() => null, (err) => (assert.doesNotMatch(err.message, /sk-secret/), err.code));
  };
  assert.equal(await codeOf(401, { error: { message: "bad key" } }), "badKey");
  assert.equal(await codeOf(404, { error: { message: "model x not found" } }), "noModel");
  assert.equal(await codeOf(400, { error: { message: "The model `x` does not exist" } }), "noModel");
  assert.equal(await codeOf(429, { error: "slow down" }), "rateLimit");
  assert.equal(await codeOf(503, "oops"), "server");
  assert.equal(await codeOf(400, { error: { message: "max_tokens too large" } }), "failed");
  assert.equal(await codeOf(200, "not json"), "failed");
});

test("nothing listening: a local server is said to be off, the internet to be away", async () => {
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${closed.address().port}/v1`;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(checkAi({ provider: "ollama", model: "m", url }), { code: "offlineLocal" });
  await assert.rejects(checkAi({ provider: "openai", model: "m", url }, { key: "k" }), { code: "offline" });
});

test("a cancelled request rejects as cancelled, not as a problem to show", async () => {
  fresh();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ask({ provider: "ollama", model: "m", url: base }, { system: "s", prompt: "p", signal: controller.signal }), (err) => err.name === "AbortError");
});

test("without a key, a provider that needs one says where to put it", async () => {
  await assert.rejects(ask({ provider: "anthropic", model: "m", url: base }, { system: "s", prompt: "p" }), { code: "noKey" });
});

test("keys are saved for you only, outside backups, and the environment wins", async () => {
  await saveKey("anthropic", "  sk-ant-saved  ");
  assert.deepEqual(await findKey("anthropic"), { key: "sk-ant-saved", from: "saved" });
  const file = join(process.env.DRACOSH_HOME, "keys.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!Object.values(DATA_FILES).includes(file), "a backup never holds keys");
  process.env.ANTHROPIC_API_KEY = "sk-ant-env";
  assert.deepEqual(await findKey("anthropic"), { key: "sk-ant-env", from: "env", env: "ANTHROPIC_API_KEY" });
  delete process.env.ANTHROPIC_API_KEY;
  await forgetKey("anthropic");
  assert.equal(await findKey("anthropic"), null);
  assert.equal(await findKey("ollama"), null);
});

test("a key is shown only by its ends", () => {
  assert.equal(maskKey("sk-ant-api03-abcdef1234"), "sk-a…1234");
  assert.equal(maskKey("short"), "•••••");
});

test("the AI setting keeps only what makes sense", () => {
  assert.deepEqual(normalizeAi({ provider: "ollama", model: " llama3.2 ", url: "http://localhost:11500/v1/" }), { provider: "ollama", model: "llama3.2", url: "http://localhost:11500/v1" });
  assert.deepEqual(normalizeAi({ provider: "anthropic", model: "claude-haiku-5-5", url: "http://evil.example" }), { provider: "anthropic", model: "claude-haiku-5-5" });
  assert.equal(normalizeAi({ provider: "custom", model: "m" }), null, "other needs an address");
  assert.equal(normalizeAi({ provider: "nope", model: "m" }), null);
  assert.equal(normalizeAi({ provider: "openai" }), null);
  assert.equal(normalizeAi("anthropic"), null);
  assert.equal(normalizeSettings({}).ai, null);
  assert.deepEqual(normalizeSettings({ ai: { provider: "custom", model: "m", url: "https://ai.example/v1" } }).ai, { provider: "custom", model: "m", url: "https://ai.example/v1" });
});

test("a key for another address is never sent: null means no key, and other keeps one per address", async () => {
  await saveKey("custom", "sk-for-a", "http://a.example/v1/");
  assert.deepEqual(await findKey("custom", "http://a.example/v1"), { key: "sk-for-a", from: "saved" });
  assert.equal(await findKey("custom", base), null, "server B doesn't get server A's key");
  fresh();
  await ask({ provider: "custom", model: "m", url: base }, { system: "s", prompt: "p" });
  assert.equal(seen[0].headers.authorization, undefined);
  await saveKey("openai", "sk-saved");
  fresh();
  await ask({ provider: "openai", model: "m", url: base }, { key: null, system: "s", prompt: "p" });
  assert.equal(seen[0].headers.authorization, undefined, "key: null is no key, not the saved one");
  await forgetKey("custom", "http://a.example/v1");
  await forgetKey("openai");
});

test("an address that isn't such an API is told apart from a missing model", async () => {
  fresh();
  reply = [404, "Not found"];
  await assert.rejects(listModels({ provider: "custom", url: base }, { key: null }), { code: "noApi" });
});

test("a server repeating the key or sending an odd error never shows it", async () => {
  fresh();
  reply = [400, { error: { message: "bad header Bearer sk-secret-123" } }];
  await assert.rejects(ask({ provider: "openrouter", model: "x", url: base }, { key: "sk-secret-123", system: "s", prompt: "p" }), (err) => err.code === "failed" && !err.message.includes("sk-secret") && err.message.includes("Bearer …"));
  fresh();
  reply = [400, { error: { code: 7 } }];
  await assert.rejects(ask({ provider: "openrouter", model: "x", url: base }, { key: "k", system: "s", prompt: "p" }), (err) => err.message.includes('{"code":7}'));
});

test("a streamed answer is heard piece by piece, from either API", async () => {
  for (const ai of [{ provider: "anthropic", model: "m", url: base }, { provider: "ollama", model: "m", url: base }]) {
    fresh();
    const pieces = [];
    const whole = await stream(ai, { key: "k", system: "s", prompt: "p", onText: (piece) => pieces.push(piece) });
    assert.equal(whole, "kot\npies");
    assert.deepEqual(pieces, ["ko", "t\npies"]);
    assert.equal(seen[0].body.stream, true);
  }
});

test("a server that ignores stream: true still gives its answer", async () => {
  fresh();
  const pieces = [];
  reply = [200, { choices: [{ message: { content: "kot = cat" } }] }];
  assert.equal(await stream({ provider: "openrouter", model: "m", url: base }, { key: "k", system: "s", prompt: "p", onText: (piece) => pieces.push(piece) }), "kot = cat");
  assert.deepEqual(pieces, ["kot = cat"]);
});
