import React, { useEffect, useState } from "react";
import { Text } from "ink";
import htm from "htm";

export const html = htm.bind(React.createElement);

// Dracosh palette: soft violet accents and a green dragon on dark, gold for fire and glory
export const theme = {
  accent: "#9d7cd8",
  good: "#4ade80",
  bad: "#f87171",
  warn: "#fbbf24",
  text: "#c9ccd3",
  track: "#3a3f47"
};

// every full-width panel (card, stats, settings…) shares this width
export const PANEL_WIDTH = 72;

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
