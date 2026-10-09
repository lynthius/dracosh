import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { html, theme } from "./kit.js";

const ROWS = 4;
const FRAME_MS = 100;
const COLORS = [theme.accent, theme.good, theme.warn, "#7dd3fc", "#f0abfc"];
const GLYPHS = ["▪", "▘", "▝", "▖", "▗", "•"];

// A short burst of falling pixels over the card, played once when the daily goal lands.
export function Confetti({ width, onDone }) {
  const particles = useMemo(
    () =>
      Array.from({ length: Math.floor(width / 2.5) }, () => ({
        col: Math.floor(Math.random() * width),
        delay: Math.floor(Math.random() * 7),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      })),
    [width]
  );
  const total = ROWS + 7 + 1;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (frame > total) onDone();
  }, [frame, total, onDone]);

  const rows = Array.from({ length: ROWS }, (_, r) => {
    const here = particles.filter((p) => frame - p.delay === r).sort((a, b) => a.col - b.col);
    const cells = [];
    let at = 0;
    for (const p of here) {
      if (p.col < at) continue; // two particles on one cell: draw the first
      cells.push(html`<${Text} key=${`g${p.col}`}>${" ".repeat(p.col - at)}<//>`);
      cells.push(html`<${Text} key=${`p${p.col}`} color=${p.color}>${p.glyph}<//>`);
      at = p.col + 1;
    }
    return html`<${Text} key=${r}>${cells.length ? cells : " "}<//>`;
  });

  return html`<${Box} flexDirection="column" paddingX=${1}>${rows}<//>`;
}
