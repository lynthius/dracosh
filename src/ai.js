import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { t } from "./i18n.js";
import { HOME } from "./store.js";

// Where AI help comes from. Anthropic speaks its own API; everything else the OpenAI-compatible one
// (`/chat/completions`, `/models`), local servers included. `keyEnv`: the environment variable read
// for the key; `local`: runs on this computer, free and with no key.
export const PROVIDERS = {
  anthropic: { api: "anthropic", url: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY", needsKey: true, model: "claude-haiku-5-5", site: "console.anthropic.com" },
  openai: { api: "openai", url: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", needsKey: true, site: "platform.openai.com/api-keys" },
  openrouter: { api: "openai", url: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", needsKey: true, site: "openrouter.ai/keys" },
  ollama: { api: "openai", url: "http://localhost:11434/v1", local: true },
  lmstudio: { api: "openai", url: "http://localhost:1234/v1", local: true },
  custom: { api: "openai", keyEnv: "DRACOSH_AI_KEY" } // any OpenAI-compatible address; a key only if it asks
};
export const PROVIDER_NAMES = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", ollama: "Ollama", lmstudio: "LM Studio", custom: null };

export const isUrl = (text) => typeof text === "string" && /^https?:\/\/[^\s/]+\S*$/i.test(text.trim());
export const cleanUrl = (text) => String(text).trim().replace(/\/+$/, "");

// settings.ai, as saved: { provider, model, url? } (url: the custom address, or a local server moved
// to another port), or null for no AI
export function normalizeAi(raw) {
  if (!raw || typeof raw !== "object" || !Object.hasOwn(PROVIDERS, raw.provider)) return null;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null;
  const url = isUrl(raw.url) && PROVIDERS[raw.provider].api === "openai" ? cleanUrl(raw.url) : null;
  if (!model || (raw.provider === "custom" && !url)) return null;
  return { provider: raw.provider, model, ...(url ? { url } : {}) };
}

export const providerName = (provider) => PROVIDER_NAMES[provider] ?? t("ai.customName");
// the endpoint as the screens show it: "✦ ollama · llama3.2"
export const aiLabel = (ai) => (ai ? `${providerName(ai.provider)} · ${ai.model}` : t("settings.off"));
export const urlOf = (ai) => ai.url ?? PROVIDERS[ai.provider].url;

// Keys live in keys.json next to the data, readable by you only, and are never part of a backup or an
// export (DATA_FILES leaves the file out). A key in the environment wins over a saved one.
const KEYS_FILE = join(HOME, "keys.json");

async function readKeys() {
  try {
    const keys = JSON.parse(await readFile(KEYS_FILE, "utf8"));
    return keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
  } catch {
    return {}; // missing or broken: no saved keys, typed again when needed
  }
}

async function writeKeys(keys) {
  await mkdir(HOME, { recursive: true });
  const tmp = `${KEYS_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(keys, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600); // the mode above only counts for a file that wasn't there
  await rename(tmp, KEYS_FILE);
}

// a key for "other" belongs to its address: it's never sent to another server
const slot = (provider, url) => (provider === "custom" ? `custom ${cleanUrl(url ?? "")}` : provider);

const envKey = (provider) => {
  const name = PROVIDERS[provider]?.keyEnv;
  const value = name && process.env[name]?.trim();
  return value ? { key: value, from: "env", env: name } : null;
};

// → { key, from: "env" | "saved", env? } or null; `url`: the address, for "other"
export async function findKey(provider, url) {
  const fromEnv = envKey(provider);
  if (fromEnv) return fromEnv;
  const saved = (await readKeys())[slot(provider, url)];
  return typeof saved === "string" && saved ? { key: saved, from: "saved" } : null;
}

export async function saveKey(provider, key, url) {
  const keys = await readKeys();
  keys[slot(provider, url)] = key.trim();
  await writeKeys(keys);
}

export async function forgetKey(provider, url) {
  const keys = await readKeys();
  if (!(slot(provider, url) in keys)) return;
  delete keys[slot(provider, url)];
  await writeKeys(keys);
}

// a key shown without giving it away: "sk-a…f3c9"
export const maskKey = (key) => (key.length <= 10 ? "•".repeat(key.length) : `${key.slice(0, 4)}…${key.slice(-4)}`);

// What went wrong, said as what to do: `code` is noKey, badKey, noModel, noApi (an address that isn't
// such an API), rateLimit, offline, offlineLocal (a server on this computer that isn't running),
// timeout, server or failed. The key is never part of the message.
export class AiError extends Error {
  constructor(code, vars = {}) {
    super(t(`ai.errors.${code}`, vars));
    this.code = code;
  }
}

const TIMEOUT_MS = 30_000;

async function call(ai, key, path, body, { signal, timeoutMs = TIMEOUT_MS } = {}) {
  const { api } = PROVIDERS[ai.provider];
  const url = `${urlOf(ai)}${path}`;
  const headers = { "content-type": "application/json" };
  if (api === "anthropic") Object.assign(headers, { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" });
  else if (key) headers.authorization = `Bearer ${key}`;
  if (ai.provider === "openrouter") headers["x-title"] = "Dracosh";
  const vars = { provider: providerName(ai.provider), model: ai.model, url: urlOf(ai) };
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(url, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    if (signal?.aborted) throw err; // cancelled by the caller: not a problem to show
    if (timeout.aborted) throw new AiError("timeout", vars);
    throw new AiError(PROVIDERS[ai.provider].local ? "offlineLocal" : "offline", vars);
  }
  let text;
  try {
    text = await response.text();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AiError(timeout.aborted ? "timeout" : "offline", vars);
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (response.ok && data) return data;
  const reason = data?.error?.message ?? data?.error ?? data?.message ?? "";
  const said = (typeof reason === "string" ? reason : JSON.stringify(reason)).split(key || "\u0000").join("…").slice(0, 200); // a server repeating the key never shows it
  if (response.ok) throw new AiError("failed", { ...vars, status: response.status, detail: t("ai.errors.notJson") });
  if (response.status === 401 || response.status === 403) throw new AiError("badKey", vars);
  if (response.status === 404 && !body) throw new AiError("noApi", vars); // listing models: the address is wrong
  if (response.status === 404 || (response.status === 400 && /model/i.test(said) && /not|unknown|invalid|exist/i.test(said))) throw new AiError("noModel", vars);
  if (response.status === 429) throw new AiError("rateLimit", vars);
  if (response.status >= 500) throw new AiError("server", { ...vars, status: response.status });
  throw new AiError("failed", { ...vars, status: response.status, detail: said || response.statusText });
}

async function keyFor(ai) {
  const found = await findKey(ai.provider, urlOf(ai));
  if (!found && PROVIDERS[ai.provider].needsKey) throw new AiError("noKey", { provider: providerName(ai.provider), env: PROVIDERS[ai.provider].keyEnv });
  return found?.key ?? null;
}

// One answer from the model: `system` sets the task, `prompt` is the message. → the text. `key`: the
// key to use, null for none; left out, the saved one (or the environment's)
export async function ask(ai, { system, prompt, maxTokens = 400, signal, timeoutMs, key }) {
  if (key === undefined) key = await keyFor(ai);
  if (PROVIDERS[ai.provider].api === "anthropic") {
    const data = await call(ai, key, "/messages", { model: ai.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }, { signal, timeoutMs });
    return (data.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("").trim();
  }
  // OpenAI's newer models take max_completion_tokens; the compatible servers know max_tokens
  const limit = ai.provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  const data = await call(ai, key, "/chat/completions", { model: ai.model, ...limit, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, { signal, timeoutMs });
  return String(data.choices?.[0]?.message?.content ?? "").trim();
}

// models that don't write text (embeddings, speech, images, moderation) can't suggest a card
const NOT_CHAT = /embed|tts|whisper|transcribe|dall-e|image|moderation|rerank|audio|realtime/i;

// the models the endpoint offers, by name (a local server lists the ones downloaded)
export async function listModels(ai, { key, signal } = {}) {
  if (key === undefined) key = await keyFor(ai);
  const data = await call({ ...ai, model: ai.model ?? "" }, key, PROVIDERS[ai.provider].api === "anthropic" ? "/models?limit=1000" : "/models", null, { signal, timeoutMs: 15_000 });
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const names = list.map((model) => model?.id ?? model?.name).filter((id) => typeof id === "string" && id && !NOT_CHAT.test(id));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

// a tiny request that proves the key, the address and the model work together
export const checkAi = (ai, { key } = {}) => ask(ai, { key, system: "Reply with the single word OK.", prompt: "OK?", maxTokens: 16 });
