import { Fragment, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { language, t } from "../i18n.js";
import { forgetKey, maskKey, saveKey } from "../ai.js";
import { ELEVENLABS, findVoiceKey, listVoices, speech, voiceLabel } from "../voice.js";
import { fold } from "../judge.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 8; // voices listed at a time
const look = (text) => fold(text.toLowerCase());
const SHORT = ["noKey", "badKey", "noCredit", "noVoice"];

// /settings → Voice: the system's voices (free, built in) or a natural one from ElevenLabs with your own
// key. For ElevenLabs: the key, the voice, then a short sample read in it; only then is anything saved.
// `current`: settings.voice. onSave(voice | null) keeps the choice. `play(file)`: plays the sample.
// `speakOn`: Read aloud is on already (picking a voice turns it on). Esc goes back a step, from the
// first one it leaves.
export function VoiceSetup({ current, onSave, onClose, play = () => {}, speakOn = true }) {
  const panel = usePanelWidth();
  const [step, setStep] = useState("provider");
  const [selected, setSelected] = useState(current ? 1 : 0);
  const [key, setKey] = useState(null); // { key, from: "env" | "saved" | "typed", env? }
  const [voices, setVoices] = useState(null);
  const [voice, setVoice] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const history = useRef([]);
  const job = useRef(0); // a newer step makes an older request's answer stale
  const request = useRef(null); // the request in flight, cancelled when it goes stale (a sample is billed)

  const go = (next, pick = 0) => {
    const at = history.current.indexOf(next);
    if (at >= 0) history.current = history.current.slice(0, at);
    else if (step !== next && step !== "checking" && step !== "failed") history.current.push(step);
    setError("");
    setMessage("");
    setSelected(pick);
    setStep(next);
  };
  const back = () => {
    job.current += 1;
    request.current?.abort();
    setError("");
    setMessage("");
    const last = history.current.pop();
    if (!last) return onClose();
    setSelected(last === "provider" ? 1 : 0);
    setStep(last);
  };
  const stillOn = () => {
    const mine = ++job.current;
    request.current?.abort();
    request.current = new AbortController();
    return () => mine === job.current;
  };
  // here the message says what's wrong, not where to fix it (this is the place)
  const said = (err) => (SHORT.includes(err.code) ? t(`voice.short.${err.code}`, { env: ELEVENLABS.keyEnv }) : err.message);

  async function pickProvider(index) {
    if (index === 0) {
      if (current) onSave(null);
      return onClose(current ? t("voice.systemSet") : undefined);
    }
    const fresh = stillOn();
    const found = await findVoiceKey();
    if (!fresh()) return;
    setKey(found);
    if (found?.from === "env") return loadVoices(found);
    go(found ? "keep-key" : "key");
  }

  async function loadVoices(withKey = key) {
    go("voices");
    const fresh = stillOn();
    setVoices(null);
    setQuery("");
    try {
      const list = await listVoices({ key: withKey?.key ?? null, url: current?.url, signal: request.current.signal });
      if (!fresh()) return;
      setVoices(list);
      setSelected(Math.max(0, list.findIndex((item) => item.id === current?.id)));
    } catch (err) {
      if (!fresh()) return;
      setVoices([]);
      if (["badKey", "noKey"].includes(err.code) && withKey?.from !== "env") {
        const at = history.current.indexOf("key");
        if (at >= 0) history.current = history.current.slice(0, at);
        setSelected(0);
        setStep("key");
      }
      setError(said(err));
    }
  }

  async function check(picked) {
    const chosen = { provider: "elevenlabs", id: picked.id, name: picked.name, ...(current?.url ? { url: current.url } : {}) };
    setVoice(chosen);
    go("checking");
    const fresh = stillOn();
    try {
      const file = await speech(chosen, t("voice.sample"), language(), { key: key?.key ?? null, signal: request.current.signal });
      if (!fresh()) return;
      play(file);
      if (key?.from === "typed") await saveKey("elevenlabs", key.key);
      onSave(chosen);
      onClose(t(speakOn ? "voice.ready" : "voice.readyOn", { label: voiceLabel(chosen) }));
    } catch (err) {
      if (!fresh()) return;
      setError(said(err));
      setStep("failed");
      setSelected(0);
    }
  }

  const found = (voices ?? []).filter((item) => !query || look(`${item.name} ${item.note}`).includes(look(query)));

  useInput((input, k) => {
    if ((step === "checking" || (step === "voices" && voices === null)) && k.escape) return back();
    if (step !== "voices" || voices === null) return;
    if (k.escape) return query ? (setQuery(""), setSelected(0)) : back();
    if (k.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (k.downArrow) return setSelected((i) => Math.min(found.length - 1, i + 1));
    if (k.return) return found[selected] && check(found[selected]);
    if (k.backspace || k.delete) return query && (setQuery((q) => q.slice(0, -1)), setSelected(0));
    const text = input.replace(/[\u0000-\u001f\u007f]/g, "");
    if (text && !k.ctrl && !k.meta) {
      setQuery((q) => q + text);
      setSelected(0);
    }
  });

  const problem = error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`;
  const frame = (title, body, hints, { errorAbove = false } = {}) => html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${title}<//>
        ${errorAbove && problem}
        ${body}
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${!errorAbove && problem}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${hints} /><//>
    <//>
  `;

  if (step === "provider") {
    const options = [{ label: t("voice.system"), note: t("voice.systemNote") }, { label: "ElevenLabs", note: t("voice.elevenNote") }];
    return frame(
      t("voice.title"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("voice.note")}<//>
          <${Box} marginTop=${1}><${Text} dimColor>${t("voice.now", { label: voiceLabel(current) })}<//><//>
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => pickProvider(i).catch((err) => setError(err.message))} onCancel=${() => onClose()} /><//>
        <//>
      `,
      choiceHints("back")
    );
  }

  if (step === "keep-key") {
    const options = [{ label: t("ai.keepKey"), note: maskKey(key.key) }, { label: t("ai.newKey") }, { label: t("ai.forgetKey"), danger: true }];
    return frame(
      t("voice.keyTitle"),
      html`<${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => {
        if (i === 0) return loadVoices();
        if (i === 1) return go("key");
        forgetKey("elevenlabs").then(() => {
          setKey(null);
          go("key");
          setMessage(t("ai.keyForgotten", { provider: "ElevenLabs" }));
        }, (err) => setError(err.message));
      }} onCancel=${back} /><//>`,
      choiceHints("back")
    );
  }

  if (step === "key")
    return frame(
      t("voice.keyTitle"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("voice.keyNote", { env: ELEVENLABS.keyEnv, site: ELEVENLABS.site })}<//>
          <${Box} marginTop=${1}><${AnswerInput} key="voice-key" plain secret escLeaves onChange=${() => (setError(""), setMessage(""))} onExit=${back} onSubmit=${(text) => {
            const typed = text.trim();
            if (!typed) return setError(t("ai.needKey"));
            const next = { key: typed, from: "typed" };
            setKey(next);
            loadVoices(next);
          }} /><//>
        <//>
      `,
      t("keyHints.importName")
    );

  if (step === "voices") {
    const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), found.length - SHOWN));
    return frame(
      t("voice.pickTitle"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${[key?.from === "env" && t("ai.keyFromEnv", { env: key.env }), t("voice.pickNote")].filter(Boolean).join(" ")}<//>
          ${voices?.length === 0 && !error && html`<${Box} marginTop=${1}><${Text}>${t("voice.noVoices")}<//><//>`}
          ${voices === null
            ? html`<${Box} marginTop=${1}><${Text} dimColor>${t("voice.loading")}<//><//>`
            : voices.length > 0 && html`
                <${Box} flexDirection="column" marginTop=${1}>
                  ${(voices.length > SHOWN || query) && html`<${Box}><${Box} flexShrink=${0}><${Text} dimColor>${t("languages.search")} <//><//><${Text} wrap="truncate-start">${query}<//><${Box} flexShrink=${0}><${Text} inverse> <//><//><//>`}
                  <${Text} dimColor>${top > 0 ? "  ↑" : " "}<//>
                  ${found.slice(top, top + SHOWN).map((item, i) => {
                    const on = top + i === selected;
                    const extra = item.id === current?.id ? t("voice.current") : item.note;
                    return html`<${Text} key=${item.id} color=${on ? theme.accent : undefined} bold=${on} wrap="truncate-end">${on ? "❯" : " "} ${cutToWidth(item.name, panel - 12)} ${extra ? html`<${Text} dimColor>· ${extra}<//>` : ""}<//>`;
                  })}
                  <${Text} dimColor>${top + SHOWN < found.length ? "  ↓" : " "}<//>
                <//>
              `}
        <//>
      `,
      voices && voices.length > SHOWN ? t("keyHints.modelPick") : choiceHints("back")
    );
  }

  if (step === "checking")
    return frame(t("voice.pickTitle"), html`<${Box} marginTop=${1}><${Text} dimColor>${t("voice.checking", { label: voiceLabel(voice) })}<//><//>`, t("keyHints.back"));

  // failed: what now (a key from the environment is changed there, not here)
  const options = [{ label: t("ai.tryAgain") }, { label: t("voice.otherVoice") }, ...(key?.from === "env" ? [] : [{ label: t("ai.otherKey") }])];
  return frame(
    t("voice.failedTitle", { label: voiceLabel(voice) }),
    html`<${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => (i === 0 ? check(voice) : i === 1 ? loadVoices() : go("key"))} onCancel=${back} /><//>`,
    choiceHints("back"),
    { errorAbove: true }
  );
}
