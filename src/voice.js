import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanUrl, findKey } from "./ai.js";
import { t } from "./i18n.js";
import { HOME } from "./store.js";

// Natural voices from ElevenLabs, with the user's own key (/settings → Voice). Optional: without one,
// words are read by the system's voices. Each word is generated once and kept in ~/.dracosh/audio,
// so a card costs once, not on every review.
export const ELEVENLABS = { url: "https://api.elevenlabs.io", keyEnv: "ELEVENLABS_API_KEY", site: "elevenlabs.io/app/settings/api-keys" };
// Flash v2.5: the cheapest per character, fast, and takes the word's language as a hint
export const MODEL = "eleven_flash_v2_5";
const LANGUAGES = new Set(["en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru", "hu", "no", "vi"]);
const CODE = { nb: "no", nn: "no", tl: "fil" };
const codeOf = (lang) => CODE[lang] ?? lang;
// a language the voice can read; the others stay with the system's voices
export const speaksLanguage = (lang) => LANGUAGES.has(codeOf(lang));

export const AUDIO_DIR = join(HOME, "audio");
const TIMEOUT_MS = 20_000;

// settings.voice, as saved: { provider: "elevenlabs", id, name, url? } (url: another of its servers, the
// EU one say), or null for the system's voices. The key goes to the address, so only ElevenLabs' own.
const isElevenLabs = (text) => typeof text === "string" && /^https:\/\/([a-z0-9-]+\.)*elevenlabs\.io\/?$/i.test(text.trim());
export function normalizeVoice(raw) {
  if (!raw || typeof raw !== "object" || raw.provider !== "elevenlabs") return null;
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : raw.id;
  return { provider: "elevenlabs", id: raw.id, name, ...(isElevenLabs(raw.url) ? { url: cleanUrl(raw.url) } : {}) };
}

export const voiceLabel = (voice) => (voice ? `ElevenLabs · ${voice.name}` : t("voice.system"));
const urlOf = (voice) => voice?.url ?? ELEVENLABS.url;

// What went wrong, said as what to do: `code` is noKey, badKey, noCredit, noVoice, rateLimit, offline,
// timeout, server or failed. The key is never part of the message.
export class VoiceError extends Error {
  constructor(code, vars = {}) {
    super(t(`voice.errors.${code}`, { env: ELEVENLABS.keyEnv, ...vars }));
    this.code = code;
  }
}

export const findVoiceKey = () => findKey("elevenlabs");

async function call(voice, key, path, { body, signal, timeoutMs = TIMEOUT_MS } = {}) {
  if (!key) throw new VoiceError("noKey");
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(`${urlOf(voice)}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json", accept: "audio/mpeg" } : {}) },
      body: body && JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new VoiceError(timeout.aborted ? "timeout" : "offline");
  }
  if (response.ok) return response;
  let detail = {};
  try {
    const data = JSON.parse(await response.text());
    detail = typeof data?.detail === "object" && data.detail ? data.detail : { message: data?.detail };
  } catch {}
  const code = detail.code ?? detail.status ?? "";
  const said = String(detail.message ?? response.statusText ?? "").split(key).join("…").slice(0, 200);
  if (response.status === 402 || /insufficient_credits|quota_exceeded/.test(code)) throw new VoiceError("noCredit");
  if (response.status === 401 || response.status === 403) throw new VoiceError("badKey");
  if (response.status === 404) throw new VoiceError("noVoice");
  if (response.status === 429) throw new VoiceError("rateLimit");
  if (response.status >= 500) throw new VoiceError("server", { status: response.status });
  throw new VoiceError("failed", { status: response.status, detail: said });
}

// the voices the account can use, premade ones included, by name. → [{ id, name, note }]
export async function listVoices({ key, url, signal } = {}) {
  const voices = [];
  let token = null;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ page_size: "100", ...(token ? { next_page_token: token } : {}) });
    const data = await (await call({ url }, key, `/v2/voices?${query}`, { signal })).json().catch(() => ({}));
    for (const voice of Array.isArray(data.voices) ? data.voices : []) {
      if (typeof voice?.voice_id !== "string" || !voice.voice_id) continue;
      const labels = voice.labels && typeof voice.labels === "object" ? voice.labels : {};
      const note = [labels.gender, labels.accent, labels.age].filter((v) => typeof v === "string" && v).join(", ");
      voices.push({ id: voice.voice_id, name: typeof voice.name === "string" && voice.name.trim() ? voice.name.trim() : voice.voice_id, note });
    }
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  const seen = new Set();
  return voices.filter((voice) => !seen.has(voice.id) && seen.add(voice.id)).sort((a, b) => a.name.localeCompare(b.name));
}

// where a word's audio is kept: one file per voice, model, language and text
export const audioPath = (voice, text, lang) => join(AUDIO_DIR, `${createHash("sha256").update(JSON.stringify([voice.id, MODEL, codeOf(lang), text])).digest("hex").slice(0, 32)}.mp3`);

// The word as an mp3 file: the kept one, or a new one from ElevenLabs. → the file's path. `key`: null
// for only a kept one; left out, the saved one (or the environment's)
export async function speech(voice, text, lang, { key, signal, timeoutMs } = {}) {
  const file = audioPath(voice, text, lang);
  try {
    if ((await stat(file)).size > 0) return file;
  } catch {}
  if (key === undefined) key = (await findVoiceKey())?.key ?? null;
  const query = new URLSearchParams({ output_format: "mp3_44100_64" });
  const response = await call(voice, key, `/v1/text-to-speech/${encodeURIComponent(voice.id)}?${query}`, { signal, timeoutMs, body: { text, model_id: MODEL, language_code: codeOf(lang) } });
  let audio;
  try {
    audio = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new VoiceError("offline");
  }
  if (!audio.length) throw new VoiceError("failed", { status: response.status, detail: t("voice.errors.empty") });
  await mkdir(AUDIO_DIR, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`; // the same word asked twice at once writes two files
  try {
    await writeFile(tmp, audio);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return file;
}
