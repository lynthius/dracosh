import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { language, t } from "../i18n.js";
import { fold } from "../judge.js";
import { DECK_LANGUAGES, isKnown, languageName, UNKNOWN } from "../language.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 7; // rows of the list at a time

// One side as read: "polski"; a side you said is none in particular, "other or mixed"; one the cards
// didn't tell yet, "not sure yet"
const sideName = (code, guessed) => languageName(code) ?? t(guessed ? "languages.notYet" : "languages.mixed");
export const pairText = ({ front, back, guessed }) =>
  guessed && !isKnown(front) && !isKnown(back) ? t("languages.notYet") : `${sideName(front, guessed)} → ${sideName(back, guessed)}`;

const look = (text) => fold(text.toLowerCase());

// a code as Intl writes it today ("iw" is "he", "in" is "id"), or null when it names no language
function canonical(code) {
  try {
    const [lang] = Intl.getCanonicalLocales(code)[0].split("-"); // "sh" is "sr-Latn": Serbian
    return /^[a-z]{2,3}$/.test(lang) && languageName(lang, "en") !== lang ? lang : null;
  } catch {
    return null;
  }
}

// The languages whose name matches what's typed: in the UI's language, in English or in the language
// itself ("deutsch", "español"), or by code. The ones set or guessed and your own language come first;
// "other or mixed" last.
function matching(query, first) {
  const all = [...new Set([...first.filter(isKnown), language(), ...DECK_LANGUAGES]), UNKNOWN];
  const q = look(query.trim());
  if (!q) return all;
  const names = (code) => (code === UNKNOWN ? [t("languages.mixed")] : [languageName(code), languageName(code, "en"), languageName(code, code), code]);
  const found = all.filter((code) => names(code).some((name) => name && look(name).includes(q)));
  const starts = found.filter((code) => names(code).some((name) => name && look(name).startsWith(q)));
  const ordered = [...new Set([...starts, ...found])];
  const typed = /^[a-z]{2}$/.test(q) ? canonical(q) : null;
  if (typed && !ordered.includes(typed)) ordered.unshift(typed);
  return ordered;
}

// Which language the front and the back are in, one side after the other: type to search, ↑/↓ and Enter.
// `languages` holds what's set or guessed now (`guessed` marks a guess); → onDone({ front, back }).
// Esc clears the search, then goes back a side, then leaves (onCancel).
export function LanguagePicker({ deck, sample, languages, onDone, onCancel }) {
  const panel = usePanelWidth();
  const [side, setSide] = useState("front");
  const [chosen, setChosen] = useState({ front: languages.front, back: languages.back });
  const [query, setQuery] = useState("");
  const listFor = (text, which = side) => matching(text, [chosen[which], languages[which]]);
  const options = listFor(query);
  // the language chosen so far stays selected until you search; then the best match is; never
  // "other or mixed" by itself
  const selectedIn = (list, which = side, text = query) => (text ? 0 : Math.max(0, isKnown(chosen[which]) ? list.indexOf(chosen[which]) : 0));
  const [selected, setSelected] = useState(() => selectedIn(options));

  function search(text, which = side) {
    setQuery(text);
    setSelected(selectedIn(listFor(text, which), which, text));
  }

  function turnTo(which) {
    setSide(which);
    search("", which);
  }

  function pick() {
    const code = options[selected];
    if (!code) return;
    const next = { ...chosen, [side]: code };
    setChosen(next);
    if (side === "front") {
      setSide("back");
      setQuery("");
      const list = matching("", [next.back, languages.back]);
      return setSelected(Math.max(0, isKnown(next.back) ? list.indexOf(next.back) : 0));
    }
    onDone(next);
  }

  useInput((input, key) => {
    if (key.escape) {
      if (query) return search("");
      return side === "back" ? turnTo("front") : onCancel();
    }
    if (key.return) return pick();
    if (key.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSelected((i) => Math.max(0, Math.min(options.length - 1, i + 1)));
    if (key.backspace || key.delete) return query && search(query.slice(0, -1));
    if (key.ctrl && input === "u") return search("");
    const text = input.replace(/[\u0000-\u001f\u007f]/g, ""); // a paste's line breaks and tabs aren't a name
    if (text && !key.ctrl && !key.meta) search(query + text);
  });

  const example = sample ? cutToWidth(side === "front" ? sample.front : sample.back.join(" / "), 24) : "";
  const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), options.length - SHOWN));
  const noteOf = (code) => {
    if (code === UNKNOWN) return t("languages.mixedNote");
    if (code !== languages[side]) return "";
    return languages.guessed ? t("languages.guessed") : t("languages.current");
  };
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t(side === "front" ? "languages.frontQuestion" : "languages.backQuestion", { deck })}<//>
        ${example && html`<${Text} dimColor>${t("languages.example", { sample: example })}<//>`}
        <${Box} marginTop=${1}>
          <${Box} flexShrink=${0}><${Text} dimColor>${t("languages.search")} <//><//>
          <${Text} wrap="truncate-start">${query}<//>
          <${Box} flexShrink=${0}><${Text} inverse> <//><//>
        <//>
        <${Box} flexDirection="column">
          ${options.length === 0 && html`<${Text} dimColor wrap="truncate-end">${t("languages.noMatch", { query: cutToWidth(query, 20) })}<//>`}
          <${Text} dimColor>${top > 0 ? "  ↑" : " "}<//>
          ${options.slice(top, top + SHOWN).map((code, i) => {
            const on = top + i === selected;
            const name = code === UNKNOWN ? t("languages.mixed") : languageName(code);
            const note = noteOf(code);
            return html`
              <${Box} key=${code}>
                <${Box} flexShrink=${0}><${Text} color=${on ? theme.accent : undefined} bold=${on}>${on ? "❯" : " "} ${name}<//><//>
                ${note && html`<${Text} dimColor wrap="truncate-end">  ${note}<//>`}
              <//>
            `;
          })}
          <${Text} dimColor>${top + SHOWN < options.length ? "  ↓" : " "}<//>
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.languagePick")} /><//>
    <//>
  `;
}
