import React, { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ELEMENTS } from "../progress.js";
import { html, KeyHints, PANEL_WIDTH, theme } from "./kit.js";
import { ELEMENT_COLOR, Mascot } from "./Mascot.js";

const FRAME_MS = 80;
// single-pixel pips on a 9×9 die, with a pixel of space between any two, so six reads as six
const SIZE = 9;
const PIPS = { tl: [2, 2], tr: [2, 6], ml: [4, 2], c: [4, 4], mr: [4, 6], bl: [6, 2], br: [6, 6] };
const FACES = {
  1: ["c"],
  2: ["tl", "br"],
  3: ["tl", "c", "br"],
  4: ["tl", "tr", "bl", "br"],
  5: ["tl", "tr", "c", "bl", "br"],
  6: ["tl", "tr", "ml", "mr", "bl", "br"]
};
const ELEMENT_NAME = { earth: "Earth", wind: "Wind", water: "Water", ice: "Ice", fire: "Fire", cosmos: "Cosmos" };

// timeline, in frames: tumbling (faces change, slower and slower, bouncing lower) → landed → the dragon changes
const LAND_AT = 30;
const FLASH_FRAMES = [36, 38];
const REVEAL_AT = 40;
const BOUNCE = [2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0];

function dieGrid(face, pipColor) {
  const last = SIZE - 1;
  const grid = Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => ((r === 0 || r === last) && (c === 0 || c === last) ? null : "#f4f4f5")));
  for (let r = 1; r < last; r++) grid[r][last] = "#c7c9d1"; // a shaded edge
  for (let c = 1; c < last; c++) grid[last][c] = "#c7c9d1";
  for (const pip of FACES[face]) {
    const [r, c] = PIPS[pip];
    grid[r][c] = pipColor;
  }
  return grid;
}

// while tumbling the shown face changes every frame at first, then every 2, then every 3
function tumblingFace(frame, result) {
  if (frame >= LAND_AT) return result;
  const step = frame < 12 ? frame : frame < 22 ? 12 + Math.floor((frame - 12) / 2) : 17 + Math.floor((frame - 22) / 3);
  const face = ((step * 5 + 2) % 6) + 1;
  return face === result && frame > LAND_AT - 4 ? (face % 6) + 1 : face; // don't give it away just before landing
}

function BigGrid({ grid }) {
  return html`
    <${Fragment}>
      ${grid.map((row, r) => html`<${Text} key=${r}>${row.map((color, c) => React.createElement(Text, { key: c, color }, color ? "██" : "  "))}<//>`)}
    <//>
  `;
}

// The roll for "Dragon's die". The element was already rolled and saved; this only shows it.
// Any key skips to the end; after the reveal, any key closes it.
export function DieRoll({ element, stage = 0, onClose, play = () => {} }) {
  const result = ELEMENTS.indexOf(element) + 1;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (frame === LAND_AT) play("close");
    if (frame === REVEAL_AT) play("evolve");
  }, [frame]);

  const revealed = frame >= REVEAL_AT;
  useInput(() => (revealed ? onClose() : setFrame(REVEAL_AT)));

  const landed = frame >= LAND_AT;
  const color = ELEMENT_COLOR[element];
  const face = tumblingFace(frame, result);
  const bounce = landed ? 0 : BOUNCE[Math.min(Math.floor(frame / 1.5), BOUNCE.length - 1)];

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${landed ? color : theme.warn} paddingX=${2} paddingY=${1} width=${PANEL_WIDTH} alignItems="center">
        <${Text} bold color=${theme.warn}>Dragon's die<//>
        <${Box} marginTop=${1} alignItems="flex-end">
          <${Box} flexDirection="column" marginBottom=${bounce} marginRight=${4}>
            <${BigGrid} grid=${dieGrid(face, landed ? color : "#2a2440")} />
          <//>
          <${Box} flexDirection="column">
            <${Mascot} stage=${stage} face=${revealed ? "happy" : "idle"} flash=${FLASH_FRAMES.includes(frame)} element=${revealed ? element : null} scale=${2} />
          <//>
        <//>
        <${Box} marginTop=${1} flexDirection="column" alignItems="center">
          ${revealed
            ? html`
                <${Fragment}>
                  <${Text} bold color=${color}>${result} · ${ELEMENT_NAME[element]}<//>
                  <${Text} dimColor>Your dragon awakened the power of ${element}. It's yours for good.<//>
                <//>
              `
            : html`<${Text} dimColor>${landed ? `${result} · ${ELEMENT_NAME[element]}` : "the die is rolling…"}<//>`}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${revealed ? "any key to continue" : "any key to skip"} /><//>
    <//>
  `;
}
