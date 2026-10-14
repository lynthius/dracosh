import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { DECK_LANGUAGES, languageName, UNKNOWN } from "../language.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 7; // rows of the list at a time

// "polski → angielski"; a side not known yet reads "unknown"
export const pairText = ({ front, back }) => `${languageName(front) ?? t("languages.unknown")} → ${languageName(back) ?? t("languages.unknown")}`;

const fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// the languages whose name (in the UI's language or in English) or code matches what's typed;
// a code that isn't on the list but is a real language ("eu", "sw") is offered too
function matching(query) {
  const all = [UNKNOWN, ...DECK_LANGUAGES];
  const q = fold(query.trim());
  if (!q) return all;
  const names = (code) => (code === UNKNOWN ? [t("languages.unknown")] : [languageName(code), languageName(code, "en"), code]);
  const found = all.filter((code) => names(code).some((name) => name && fold(name).includes(q)));
  const starts = found.filter((code) => names(code).some((name) => name && fold(name).startsWith(q)));
  const ordered = [...new Set([...starts, ...found])];
  if (/^[a-z]{2}$/.test(q) && !ordered.includes(q) && languageName(q, "en") !== q) ordered.unshift(q);
  return ordered;
}

// Which language the front and the back are in, one side after the other: type to search, ↑/↓ and Enter.
// `languages` holds what's set or guessed now (`guessed` marks a guess); → onDone({ front, back }).
export function LanguagePicker({ deck, sample, languages, onDone, onCancel }) {
  const panel = usePanelWidth();
  const [side, setSide] = useState("front");
  const [chosen, setChosen] = useState({ front: languages.front, back: languages.back });
  const [query, setQuery] = useState("");
  const options = matching(query);
  const [selected, setSelected] = useState(Math.max(0, options.indexOf(languages.front)));

  function start(nextSide, list = matching("")) {
    setSide(nextSide);
    setQuery("");
    setSelected(Math.max(0, list.indexOf(chosen[nextSide])));
  }

  function pick() {
    const code = options[selected];
    if (!code) return;
    const next = { ...chosen, [side]: code };
    setChosen(next);
    if (side === "front") return start("back");
    onDone(next);
  }

  useInput((input, key) => {
    if (key.escape) {
      if (query) {
        setQuery("");
        return setSelected(0);
      }
      return side === "back" ? start("front") : onCancel();
    }
    if (key.return) return pick();
    if (key.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSelected((i) => Math.min(options.length - 1, i + 1));
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return setSelected(0);
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setQuery((q) => q + input);
      setSelected(0);
    }
  });

  const example = sample ? cutToWidth(side === "front" ? sample.front : sample.back.join(" / "), 24) : "";
  const first = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), options.length - SHOWN));
  const noteOf = (code) =>
    code === UNKNOWN ? t("languages.unknownNote") : code === languages[side] ? (languages.guessed ? t("languages.guessed") : t("decks.now")) : "";
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t(side === "front" ? "languages.frontQuestion" : "languages.backQuestion", { deck })}<//>
        ${example && html`<${Text} dimColor>${t("languages.example", { sample: example })}<//>`}
        <${Box} marginTop=${1}>
          <${Text} dimColor>${t("languages.search")} <//>
          <${Text}>${query}<//>
          <${Text} inverse> <//>
        <//>
        <${Box} marginTop=${1} flexDirection="column">
          ${options.length === 0 && html`<${Text} dimColor>${t("languages.noMatch", { query })}<//>`}
          ${options.slice(first, first + SHOWN).map((code, i) => {
            const on = first + i === selected;
            const name = code === UNKNOWN ? t("languages.unknown") : `${languageName(code)} (${code})`;
            return html`
              <${Box} key=${code}>
                <${Text} color=${on ? theme.accent : undefined} bold=${on}>${on ? "❯" : " "} ${name}<//>
                ${noteOf(code) && html`<${Text} dimColor>  ${noteOf(code)}<//>`}
              <//>
            `;
          })}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.languagePick")} /><//>
    <//>
  `;
}
