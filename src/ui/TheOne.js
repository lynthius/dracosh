import React, { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { RING } from "./icons.js";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";

const FRAME_MS = 110;
const WIDTH = 16; // pixels; each is drawn two characters wide
const HEIGHT = 15;
const LAVA_TOP = 11; // first row of lava; the ring is hidden wherever it's below this
const RING_LEFT = 4;
const RING_REST = 2; // the ring's top row once it's fully out

// timeline, in frames: bubbling lava → the ring rises (one row every 2 frames) → it cools → reveal
const RISE_FROM = 10;
const RISE_TO = RISE_FROM + (LAVA_TOP - RING_REST) * 2;
const COOLED_AT = RISE_TO + 6;
const REVEAL_AT = COOLED_AT + 4;

const LAVA = { R: "#9f1d0d", O: "#ea580c", Y: "#fbbf24" };
// the ring glows while it comes out of the lava, then cools down to gold
const HEAT = [
  { G: "#ff7a1a", D: "#c2410c", W: "#fde68a" },
  { G: "#fbbf24", D: "#d97706", W: "#fef3c7" },
  RING.palette
];
const SPARKS = ["✦", "·", "✧", "*"];

function lavaColor(x, y, frame) {
  const n = (x * 7 + y * 3 + Math.floor(frame / 2) * 5) % 9;
  if (y === LAVA_TOP && (x + Math.floor(frame / 2)) % 5 === 0) return null; // a wavy surface
  return n < 2 ? LAVA.Y : n < 6 ? LAVA.O : LAVA.R;
}

// a few bubbles popping just above the surface
function bubbleColor(x, y, frame) {
  for (const [bx, offset] of [[3, 0], [9, 2], [13, 4]]) {
    const t = (frame + offset) % 6;
    if (x === bx && t < 3 && y === LAVA_TOP - 1 - t) return LAVA.O;
  }
  return null;
}

function ringTop(frame) {
  if (frame < RISE_FROM) return LAVA_TOP + 1; // still fully submerged
  return Math.max(RING_REST, LAVA_TOP - Math.floor((frame - RISE_FROM) / 2));
}

function heatOf(frame) {
  if (frame < RISE_TO + 2) return HEAT[0];
  return frame < COOLED_AT ? HEAT[1] : HEAT[2];
}

// → rows of colors (null = empty) for one frame
function scene(frame) {
  const top = ringTop(frame);
  const heat = heatOf(frame);
  return Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => {
      if (y >= LAVA_TOP) return lavaColor(x, y, frame);
      const ry = y - top;
      const rx = x - RING_LEFT;
      const pixel = RING.grid[ry]?.[rx];
      if (pixel && pixel !== ".") return heat[pixel];
      return bubbleColor(x, y, frame);
    })
  );
}

function BigScene({ rows }) {
  return html`
    <${Fragment}>
      ${rows.map(
        (row, r) => html`<${Text} key=${r}>${row.map((color, c) => React.createElement(Text, { key: c, color }, color ? "██" : "  "))}<//>`
      )}
    <//>
  `;
}

const sparkleRow = (frame, seed) =>
  Array.from({ length: 30 }, (_, i) => ((i * 7 + seed * 13 + frame * 3) % 11 === 0 ? SPARKS[(i + frame) % SPARKS.length] : " ")).join("");

// The ceremony for "The One", the badge for collecting every other badge: a ring rises from the lava.
// Any key skips to the end; after the reveal, any key closes it.
export function TheOne({ onClose, play = () => {} }) {
  const panel = usePanelWidth();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (frame === RISE_FROM) play("close");
    if (frame === REVEAL_AT) play("evolve");
  }, [frame]);

  const revealed = frame >= REVEAL_AT;
  useInput(() => (revealed ? onClose() : setFrame(REVEAL_AT)));
  const caption = frame < RISE_FROM ? "the lava is stirring…" : "something rises…";

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.warn} paddingX=${2} paddingY=${1} width=${panel} alignItems="center">
        <${Text} color=${theme.warn}>${revealed ? sparkleRow(frame, 1) : " "}<//>
        <${Box} flexDirection="column" alignItems="center">
          <${BigScene} rows=${scene(frame)} />
        <//>
        <${Box} marginTop=${1} flexDirection="column" alignItems="center">
          ${revealed
            ? html`
                <${Fragment}>
                  <${Text} bold color=${RING.palette.G}>The One...<//>
                  <${Text} dimColor>Every badge is yours. The hoard is complete.<//>
                <//>
              `
            : html`<${Text} dimColor>${caption}<//>`}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${revealed ? "any key to continue" : "any key to skip"} /><//>
    <//>
  `;
}
