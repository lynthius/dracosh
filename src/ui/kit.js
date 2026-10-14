import React, { createContext, useContext, useEffect, useState } from "react";
import { Text as InkText, Transform, useStdout } from "ink";
import htm from "htm";
import { t } from "../i18n.js";

export const html = htm.bind(React.createElement);

// Ink wraps with wrap-ansi and keeps the spaces, so when a word ends exactly at the edge, the space
// after it starts the next line (" elle viendra…"). In a text without line breaks of its own, any
// line after the first comes from wrapping, and a space at its start is that leftover: it goes.
// A space painted inverse or on a background (the answer line's cursor) is something to see: it stays.
const unspill = (line, index) => {
  if (index === 0) return line;
  const [, codes, space] = /^((?:\x1b\[[\d;]*m)*)(\s*)/.exec(line);
  return !space || /\x1b\[(?:7|4\d|10\d)[;m]/.test(codes) ? line : codes + line.slice(codes.length + space.length);
};
const InsideText = createContext(false);
const hasLineBreak = (node) =>
  typeof node === "string" ? node.includes("\n") : Array.isArray(node) ? node.some(hasLineBreak) : Boolean(node?.props) && hasLineBreak(node.props.children);

// Ink's Text, minus that space. Only the outermost Text wraps, so only it gets the fix; a Text that
// truncates instead of wrapping, or has line breaks of its own (indentation may follow them), is
// left as it is. Every UI file takes Text from here.
export function Text(props) {
  const nested = useContext(InsideText);
  const text = React.createElement(InkText, props);
  if (nested || (props.wrap && props.wrap !== "wrap") || hasLineBreak(props.children)) return text;
  return React.createElement(InsideText.Provider, { value: true }, React.createElement(Transform, { transform: unspill }, text));
}

// Dracosh palette: soft violet accents and a green dragon on dark, gold for fire and glory
export const theme = {
  accent: "#9d7cd8",
  good: "#4ade80",
  bad: "#f87171",
  warn: "#fbbf24",
  text: "#c9ccd3",
  hint: "#8b919c", // the words in key hints: quieter than text, easier to read than dim
  track: "#3a3f47"
};

// Text where `backticks` mark something to type: shown in the accent color on a faint violet
// background, like code in docs. Used for the tour's cards; `plain` shows the text as it is.
export function Marked({ text, plain = false, ...props }) {
  if (plain) return React.createElement(Text, props, text);
  const parts = text.split(/`([^`]+)`/);
  return React.createElement(
    Text,
    props,
    ...parts.map((part, i) => (i % 2 ? React.createElement(Text, { key: i, color: theme.accent, backgroundColor: "#2a2440", bold: true }, part) : part))
  );
}

// the key at the start of a hint segment: "enter", "esc", "/add", "↑/↓", "any key", "q"…; the
// longer key names come from the locale ("échap", "dowolny klawisz")
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keyPattern = () => new RegExp(`^(${[...t("keyHints.keyNames").split("|").map((name) => escapeRegExp(name).replace(/ /g, "[ \u00a0]")), "↑/↓", "←/→", "\\/\\S*", "[\\p{L}\\d]"].join("|")})(?=[\\s,]|$)`, "u");

// A footer like "enter submit · / commands · esc quit": each key stands out, the words after it
// stay quiet, and the dots between them fade back. A narrow pane wraps it between hints, never
// between a key and what it does.
export function KeyHints({ text }) {
  const parts = text.split(" · ").map((part) => part.replace(/ /g, "\u00a0"));
  const KEY = keyPattern();
  return React.createElement(
    Text,
    null,
    ...parts.flatMap((part, i) => {
      const key = KEY.exec(part)?.[0];
      const rest = key ? part.slice(key.length) : part;
      return [
        i > 0 && React.createElement(Text, { key: `s${i}`, color: "#5a606b" }, " · "),
        key && React.createElement(Text, { key: `k${i}`, color: theme.text }, key),
        React.createElement(Text, { key: `r${i}`, color: theme.hint }, rest)
      ].filter(Boolean);
    })
  );
}

// every full-width panel (card, stats, settings…) shares this width
export const PANEL_WIDTH = 72;
const MIN_PANEL_WIDTH = 30;

// How many terminal cells text takes: CJK characters and emoji take two. Close enough for labels
// and deck names; whole characters (not UTF-16 halves) are counted, so an emoji is never cut in two.
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\p{Extended_Pictographic}]/u;
export const cellWidth = (text) => Array.from(text).reduce((sum, ch) => sum + (WIDE.test(ch) ? 2 : 1), 0);
export function cutToWidth(text, cells) {
  if (cellWidth(text) <= cells) return text;
  let out = "";
  for (const ch of text) {
    if (cellWidth(out + ch) > cells - 1) break;
    out += ch;
  }
  return `${out}…`;
}

// the panel width for this terminal: PANEL_WIDTH, or less in a narrow window (some terminals report 0)
export function usePanelWidth() {
  const { stdout } = useStdout();
  return Math.max(MIN_PANEL_WIDTH, Math.min((stdout?.columns || PANEL_WIDTH + 2) - 2, PANEL_WIDTH));
}

// A thin line: the filled part in `color`, the rest as a dim track. Plain box-drawing characters render
// at exactly one cell in every terminal font, unlike the geometric-shape glyphs a font may substitute.
export function Bar({ value, max, width = 10, color = theme.accent }) {
  const filled = max > 0 ? Math.round(width * Math.min(value / max, 1)) : 0;
  return html`<${Text}><${Text} color=${color}>${"━".repeat(filled)}<//><${Text} color=${theme.track}>${"━".repeat(width - filled)}<//><//>`;
}

// Like Bar, but the fill slides to its new value one cell at a time instead of jumping.
export function AnimatedBar({ value, max, width = 10, color = theme.accent, stepMs = 45 }) {
  const target = max > 0 ? Math.round(width * Math.min(value / max, 1)) : 0;
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setFilled((f) => {
        if (f === target) {
          clearInterval(id);
          return f;
        }
        return f + Math.sign(target - f);
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [target, stepMs]);
  return html`<${Text}><${Text} color=${color}>${"━".repeat(filled)}<//><${Text} color=${theme.track}>${"━".repeat(Math.max(0, width - filled))}<//><//>`;
}

// Text that types itself in. The hidden tail is padded with spaces so the layout doesn't jump while typing.
export function Typewriter({ text, dimColor = false, color, charsPerTick = 2, tickMs = 30 }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + charsPerTick;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [text, charsPerTick, tickMs]);
  const visible = text.slice(0, shown);
  return html`<${Text} color=${color} dimColor=${dimColor}>${shown >= text.length ? text : visible + " ".repeat(text.length - visible.length)}<//>`;
}
