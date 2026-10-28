import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { aiLabel, checkAi, cleanUrl, findKey, forgetKey, isSmallModel, isUrl, listModels, maskKey, PROVIDERS, providerName, saveKey, urlOf } from "../ai.js";
import { fold } from "../judge.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const ORDER = ["anthropic", "openai", "openrouter", "ollama", "lmstudio", "custom"];
const SHOWN = 8; // models listed at a time
const look = (text) => fold(text.toLowerCase());

// /settings → AI help: where it comes from (provider, the address for "other"), the key, the model, then
// a tiny request to check they work together; only then is anything saved. `current`: settings.ai.
// onSave(ai | null) keeps the choice (null: AI off). Esc goes back a step, from the first one it leaves.
export function AiSetup({ current, onSave, onClose, note = t("ai.note") }) {
  const panel = usePanelWidth();
  const [step, setStep] = useState("provider");
  const [selected, setSelected] = useState(() => Math.max(0, ORDER.indexOf(current?.provider)));
  const [draft, setDraft] = useState(current ?? {}); // { provider, url?, model }
  const [key, setKey] = useState(null); // { key, from: "env" | "saved" | "typed", env? }
  const [models, setModels] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const history = useRef([]);
  const job = useRef(0); // a newer step makes an older request's answer stale

  // Esc goes back along the steps taken; going to a step taken before cuts the way back to it, and the
  // passing steps (checking, failed) are never gone back to
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
    setError("");
    setMessage("");
    const last = history.current.pop();
    if (!last) return onClose();
    setSelected(last === "provider" ? Math.max(0, ORDER.indexOf(draft.provider)) : 0);
    setStep(last);
  };
  // after a step's answer arrives: still the step it was asked on?
  const stillOn = () => {
    const mine = ++job.current;
    return () => mine === job.current;
  };

  const preset = PROVIDERS[draft.provider];

  async function pickProvider(index) {
    if (index === ORDER.length) {
      onSave(null);
      return onClose(t("ai.turnedOff"));
    }
    const provider = ORDER[index];
    const same = current?.provider === provider;
    // a local server moved to another port keeps its address
    const next = { provider, url: same ? current.url : undefined, model: same ? current.model : PROVIDERS[provider].model };
    setDraft(next);
    if (provider === "custom") return go("url");
    if (PROVIDERS[provider].local) return setKey(null), loadModels(next, null);
    await askForKey(next);
  }

  // the key: the environment's is used as it is, a saved one can stay, be replaced or go
  async function askForKey(next) {
    const fresh = stillOn();
    const found = await findKey(next.provider, urlOf(next));
    if (!fresh()) return;
    setKey(found);
    if (found?.from === "env") return loadModels(next, found);
    go(found ? "keep-key" : "key");
  }

  async function loadModels(target = draft, withKey = key) {
    go("models");
    const fresh = stillOn();
    setModels(null);
    setQuery("");
    try {
      const list = await listModels(target, { key: withKey?.key ?? null });
      if (!fresh()) return;
      // where you pay per use, the small, cheap models come first
      const sorted = !PROVIDERS[target.provider].needsKey ? list : [...list.filter(isSmallModel), ...list.filter((name) => !isSmallModel(name))];
      setModels(sorted);
      setSelected(Math.max(0, sorted.indexOf(target.model ?? PROVIDERS[target.provider].model)));
    } catch (err) {
      if (!fresh()) return;
      // a key or an address to fix: back where it's typed, the reason with it
      const fixAt = ["badKey", "noKey"].includes(err.code) && withKey?.from !== "env" && !PROVIDERS[target.provider].local ? "key" : err.code === "noApi" && target.provider === "custom" ? "url" : null;
      setModels([]);
      if (fixAt) {
        const at = history.current.indexOf(fixAt);
        if (at >= 0) history.current = history.current.slice(0, at);
        setSelected(0);
        setStep(fixAt);
      }
      setError(err.message);
    }
  }

  async function check(model) {
    const chosen = { provider: draft.provider, model, ...(draft.url ? { url: cleanUrl(draft.url) } : {}) };
    setDraft(chosen);
    go("checking");
    const fresh = stillOn();
    try {
      await checkAi(chosen, { key: key?.key ?? null });
      if (!fresh()) return;
      if (key?.from === "typed") await saveKey(chosen.provider, key.key, urlOf(chosen));
      onSave(chosen);
      onClose(t("ai.ready", { label: aiLabel(chosen) }));
    } catch (err) {
      if (!fresh()) return;
      setError(err.message);
      setStep("failed");
      setSelected(0);
    }
  }

  const found = (models ?? []).filter((name) => !query || look(name).includes(look(query)));
  const rows = [...found, null]; // null: type a name

  useInput((input, key) => {
    if ((step === "checking" || (step === "models" && models === null)) && key.escape) return back();
    if (step !== "models" || models === null) return;
    if (key.escape) return query ? (setQuery(""), setSelected(0)) : back();
    if (key.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSelected((i) => Math.min(rows.length - 1, i + 1));
    if (key.return) return rows[selected] === null ? go("model-name") : check(rows[selected]);
    if (key.backspace || key.delete) return query && (setQuery((q) => q.slice(0, -1)), setSelected(0));
    const text = input.replace(/[\u0000-\u001f\u007f]/g, "");
    if (text && !key.ctrl && !key.meta) {
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
  const name = providerName(draft.provider);
  const keyTitle = draft.provider === "custom" ? t("ai.keyTitleCustom") : t("ai.keyTitle", { provider: name });

  if (step === "provider") {
    const options = ORDER.map((provider) => ({ label: providerName(provider), note: t(`ai.providers.${provider}`) }));
    if (current) options.push({ label: t("ai.turnOff"), danger: true });
    return frame(
      t("ai.title"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${note}<//>
          ${current && html`<${Text} dimColor>${t("ai.now", { label: aiLabel(current) })}<//>`}
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => pickProvider(i).catch((err) => setError(err.message))} onCancel=${() => onClose()} /><//>
        <//>
      `,
      choiceHints("back")
    );
  }

  if (step === "url")
    return frame(
      t("ai.urlTitle"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("ai.urlNote")}<//>
          <${Box} marginTop=${1}><${AnswerInput} key="url" plain escLeaves initial=${draft.url ?? ""} onChange=${() => setError("")} onExit=${back} onSubmit=${(text) => {
            if (!isUrl(text)) return setError(t("ai.badUrl"));
            const next = { ...draft, url: cleanUrl(text) };
            setDraft(next);
            askForKey(next).catch((err) => setError(err.message));
          }} /><//>
        <//>
      `,
      t("keyHints.importName")
    );

  if (step === "keep-key") {
    const options = [{ label: t("ai.keepKey"), note: maskKey(key.key) }, { label: t("ai.newKey") }, { label: t("ai.forgetKey"), danger: true }];
    return frame(
      keyTitle,
      html`<${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => {
        if (i === 0) return loadModels();
        if (i === 1) return go("key");
        forgetKey(draft.provider, urlOf(draft)).then(() => {
          setKey(null);
          go("key");
          setMessage(t("ai.keyForgotten", { provider: name }));
        }, (err) => setError(err.message));
      }} onCancel=${back} /><//>`,
      choiceHints("back")
    );
  }

  if (step === "key") {
    const optional = !preset?.needsKey;
    return frame(
      keyTitle,
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${optional ? t("ai.keyOptional") : t("ai.keyNote", { env: preset.keyEnv, site: preset.site })}<//>
          <${Box} marginTop=${1}><${AnswerInput} key="api-key" plain secret escLeaves onChange=${() => (setError(""), setMessage(""))} onExit=${back} onSubmit=${(text) => {
            const typed = text.trim();
            if (!typed && !optional) return setError(t("ai.needKey"));
            const next = typed ? { key: typed, from: "typed" } : null;
            setKey(next);
            loadModels(draft, next);
          }} /><//>
        <//>
      `,
      t("keyHints.importName")
    );
  }

  if (step === "model-name")
    return frame(
      t("ai.modelTitle"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("ai.modelNameNote", { provider: name })}<//>
          <${Box} marginTop=${1}><${AnswerInput} key="model-name" plain escLeaves initial=${draft.model ?? ""} onChange=${() => setError("")} onExit=${back} onSubmit=${(text) => (text.trim() ? check(text.trim()) : setError(t("ai.needModel")))} /><//>
        <//>
      `,
      t("keyHints.importName")
    );

  if (step === "models") {
    const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), rows.length - SHOWN));
    return frame(
      t("ai.modelTitle"),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${[key?.from === "env" && t("ai.keyFromEnv", { env: key.env }), preset.local ? t("ai.localNote", { url: urlOf(draft) }) : t("ai.modelNote")].filter(Boolean).join(" ")}<//>
          ${models?.length === 0 && !error && html`<${Box} marginTop=${1}><${Text}>${preset.local ? t("ai.noModelsLocal") : t("ai.noModels")}<//><//>`}
          ${models === null
            ? html`<${Box} marginTop=${1}><${Text} dimColor>${t("ai.loadingModels", { provider: name })}<//><//>`
            : html`
                <${Box} flexDirection="column" marginTop=${1}>
                  ${(models.length > SHOWN || query) && html`<${Box}><${Box} flexShrink=${0}><${Text} dimColor>${t("languages.search")} <//><//><${Text} wrap="truncate-start">${query}<//><${Box} flexShrink=${0}><${Text} inverse> <//><//><//>`}
                  <${Text} dimColor>${top > 0 ? "  ↑" : " "}<//>
                  ${rows.slice(top, top + SHOWN).map((row, i) => {
                    const on = top + i === selected;
                    return html`<${Text} key=${row ?? "type"} color=${on ? theme.accent : row === null ? theme.good : undefined} bold=${on} wrap="truncate-end">${on ? "❯" : " "} ${row === null ? t("ai.typeModel") : cutToWidth(row, panel - 12)}${row && row === current?.model && draft.provider === current?.provider ? html`<${Text} dimColor> · ${t("ai.current")}<//>` : row && preset.needsKey && isSmallModel(row) ? html`<${Text} dimColor> · ${t("ai.small")}<//>` : ""}<//>`;
                  })}
                  <${Text} dimColor>${top + SHOWN < rows.length ? "  ↓" : " "}<//>
                <//>
              `}
        <//>
      `,
      models && models.length > SHOWN ? t("keyHints.modelPick") : choiceHints("back")
    );
  }

  if (step === "checking")
    return frame(t("ai.modelTitle"), html`<${Box} marginTop=${1}><${Text} dimColor>${t("ai.checking", { label: aiLabel(draft) })}<//><//>`, t("keyHints.back"));

  // failed: what now
  // a key from the environment is changed there, not here
  const options = [{ label: t("ai.tryAgain") }, { label: t("ai.otherModel") }, ...(preset?.local || key?.from === "env" ? [] : [{ label: t("ai.otherKey") }])];
  return frame(
    t("ai.failedTitle", { label: aiLabel(draft) }),
    html`<${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${(i) => (i === 0 ? check(draft.model) : i === 1 ? loadModels() : go("key"))} onCancel=${back} /><//>`,
    choiceHints("back"),
    { errorAbove: true }
  );
}
