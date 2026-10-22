import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { language, t } from "../i18n.js";
import { fold } from "../judge.js";
import { DECK_LANGUAGES, GENDERED_LANGUAGES, isKnown, languageName, learningSide, UNKNOWN } from "../language.js";
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
// `languages` holds what's set or guessed now (`guessed` marks a guess). With two different languages a
// third question follows: which one you're learning (`learning`: { lang } now, see learningSide).
// `start: "learning"` asks only that. → onDone({ front, back, learning }), `learning` a language code,
// null for a deck in one language. Esc clears the search, then goes back a step, then leaves (onCancel).
export function LanguagePicker({ deck, sample, languages, learning = null, home, start = "front", onDone, onCancel }) {
  const panel = usePanelWidth();
  const [side, setSide] = useState(start);
  const [chosen, setChosen] = useState({ front: languages.front, back: languages.back });
  const [query, setQuery] = useState("");
  const listFor = (text, which = side) => matching(text, [chosen[which], languages[which]]);
  const options = listFor(query);
  // the language chosen so far stays selected until you search; then the best match is; never
  // "other or mixed" by itself
  const selectedIn = (list, which = side, text = query) => (text ? 0 : Math.max(0, isKnown(chosen[which]) ? list.indexOf(chosen[which]) : 0));
  // the language you're learning stays selected; for a pair just picked, the guess for it
  const learningIndex = (pair) => {
    if (learning?.lang === pair.front) return 0;
    if (learning?.lang === pair.back) return 1;
    return learningSide(pair, { name: deck }, home)?.side === "front" ? 0 : 1;
  };
  const [selected, setSelected] = useState(() => (start === "learning" ? learningIndex(chosen) : selectedIn(options)));

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
    if (isKnown(next.front) && isKnown(next.back) && next.front !== next.back) {
      setSide("learning");
      return setSelected(learningIndex(next));
    }
    onDone({ ...next, learning: null });
  }

  useInput((input, key) => {
    if (side === "learning") {
      if (key.escape || key.leftArrow) return start === "learning" ? onCancel() : turnTo("back");
      if (key.upArrow || key.downArrow) return setSelected((i) => 1 - i);
      if (input === "1" || input === "2") return onDone({ ...chosen, learning: input === "1" ? chosen.front : chosen.back });
      if (key.return) return onDone({ ...chosen, learning: selected === 1 ? chosen.back : chosen.front });
      return;
    }
    if (key.escape || key.leftArrow) {
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

  if (side === "learning")
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("languages.learningQuestion", { deck })}<//>
          <${Text} dimColor>${t("languages.learningNote")}${[chosen.front, chosen.back].some((code) => GENDERED_LANGUAGES.includes(code)) ? ` ${t("languages.learningArticles")}` : ""}${[chosen.front, chosen.back].includes("de") ? ` ${t("languages.learningUmlauts")}` : ""}<//>
          <${Box} marginTop=${1} flexDirection="column">
            ${["front", "back"].map((which, i) => html`<${Text} key=${which} color=${i === selected ? theme.accent : undefined} bold=${i === selected}>${i === selected ? "❯" : " "} ${i + 1}. ${languageName(chosen[which])}<//>`)}
          <//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.choiceLeft", { choose: t("choice.keys") })} /><//>
      <//>
    `;

  const example = sample ? cutToWidth(side === "front" ? sample.front : sample.back.join(" / "), 24) : "";
  const noteOf = (code) => {
    if (code === UNKNOWN) return t("languages.mixedNote");
    if (code !== languages[side]) return "";
    return languages.guessed ? t("languages.guessed") : t("languages.current");
  };
  return html`<${LanguageList} title=${t(side === "front" ? "languages.frontQuestion" : "languages.backQuestion", { deck })} note=${example && t("languages.example", { sample: example })} query=${query} options=${options} selected=${selected} noteOf=${noteOf} />`;
}

// the search and its list, as both pickers show them; `nameOf` names an option (a language by default)
// `step`: where in a series of questions this one is ("2/4"), said in the key hints
function LanguageList({ title, note, query, options, selected, noteOf, noMatch = options.length === 0, step = "", nameOf = (code) => (code === UNKNOWN ? t("languages.mixed") : languageName(code)) }) {
  const panel = usePanelWidth();
  const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), options.length - SHOWN));
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${title}<//>
        ${note && html`<${Text} dimColor>${note}<//>`}
        <${Box} marginTop=${1}>
          <${Box} flexShrink=${0}><${Text} dimColor>${t("languages.search")} <//><//>
          <${Text} wrap="truncate-start">${query}<//>
          <${Box} flexShrink=${0}><${Text} inverse> <//><//>
        <//>
        <${Box} flexDirection="column">
          ${noMatch && html`<${Text} dimColor wrap="truncate-end">${t("languages.noMatch", { query: cutToWidth(query, 20) })}<//>`}
          <${Text} dimColor>${top > 0 ? "  ↑" : " "}<//>
          ${options.slice(top, top + SHOWN).map((code, i) => {
            const on = top + i === selected;
            const extra = noteOf(code);
            return html`
              <${Box} key=${code}>
                <${Box} flexShrink=${0}><${Text} color=${on ? theme.accent : undefined} bold=${on}>${on ? "❯" : " "} ${nameOf(code)}<//><//>
                ${extra && html`<${Text} dimColor wrap="truncate-end">  ${extra}<//>`}
              <//>
            `;
          })}
          <${Text} dimColor>${top + SHOWN < options.length ? "  ↓" : " "}<//>
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${step ? `${step} · ${t("keyHints.languagePick")}` : t("keyHints.languagePick")} /><//>
    <//>
  `;
}

// One language, asked with a search (the welcome, /settings): `current` selected to begin with, and
// marked `currentNote` ("current", or "suggested" for a guess); `exclude` left out. `other`: a last
// option for "none of these" (UNKNOWN), named so and always there, whatever is typed. → onPick(code);
// Esc clears the search, then goes back (onBack).
export function LanguageSearch({ title, note, current = null, currentNote = t("languages.current"), exclude = [], other = null, step = "", onPick, onBack }) {
  const listFor = (text) => [...matching(text, [current]).filter((code) => code !== UNKNOWN && !exclude.includes(code)), ...(other ? [UNKNOWN] : [])];
  const [query, setQuery] = useState("");
  const options = listFor(query);
  const startAt = (list) => Math.max(0, current ? list.indexOf(current) : 0);
  const [selected, setSelected] = useState(() => startAt(options));

  function search(text) {
    setQuery(text);
    setSelected(text ? 0 : startAt(listFor(text)));
  }

  useInput((input, key) => {
    if (key.escape || key.leftArrow) return query ? search("") : onBack?.();
    if (key.return) return options[selected] && onPick(options[selected]);
    if (key.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSelected((i) => Math.max(0, Math.min(options.length - 1, i + 1)));
    if (key.backspace || key.delete) return query && search(query.slice(0, -1));
    if (key.ctrl && input === "u") return search("");
    const text = input.replace(/[\u0000-\u001f\u007f]/g, "");
    if (text && !key.ctrl && !key.meta) search(query + text);
  });

  const nameOf = (code) => (code === UNKNOWN ? other : languageName(code));
  const noteOf = (code) => (code === current ? currentNote : "");
  const noMatch = Boolean(query) && options.every((code) => code === UNKNOWN) && !(other && look(other).includes(look(query.trim())));
  return html`<${LanguageList} title=${title} note=${note} query=${query} options=${options} selected=${selected} noteOf=${noteOf} nameOf=${nameOf} noMatch=${noMatch} step=${step} />`;
}
