import React, { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, PANEL_WIDTH, theme } from "./kit.js";
import { Mascot } from "./Mascot.js";

const FRAME_MS = 110;
// a cream egg with green dragon spots: O outline, L shell, D shade, S spot, K crack
const EGG = [
  "............",
  "....OOOO....",
  "...OLLLLO...",
  "..OLLSSLLO..",
  "..OLLLLLLO..",
  ".OLSLLLLSLO.",
  ".OLLLLLLLLO.",
  ".OLLLLSLLLO.",
  "..ODDDDDDO..",
  "...OOOOOO..."
];
const EGG_COLORS = { O: "#5a5040", L: "#f3ead7", D: "#cdbf9f", S: "#58a66d", K: "#2a241c" };
const FLASH_COLORS = { O: "#d8e8dc", L: "#ffffff", D: "#eef6f0", S: "#ffffff", K: "#ffffff" };
const CRACKS = [
  [[4, 5, "K"], [5, 6, "K"], [4, 7, "K"]],
  [[6, 3, "K"], [5, 4, "K"], [6, 5, "K"], [5, 8, "K"], [6, 8, "K"], [3, 4, "K"]]
];

// the timeline, in frames: rest → wobble → crack → wobble → crack → shake → flash → dragon
const CRACK_AT = [16, 26];
const FLASH_AT = 36;
const REVEAL_AT = 41;

const wobble = (frame) => {
  if (frame < 8) return 0;
  const speed = frame < CRACK_AT[1] ? 2 : 1; // the egg shakes faster once it's badly cracked
  return Math.floor(frame / speed) % 2 === 0 ? 1 : -1;
};

function eggGrid(frame) {
  const grid = EGG.map((row) => [...row]);
  CRACKS.forEach((edits, i) => {
    if (frame >= CRACK_AT[i]) edits.forEach(([r, c, p]) => (grid[r][c] = p));
  });
  const dx = wobble(frame);
  return dx ? grid.map((row) => row.map((_, c) => row[c - dx] ?? ".")) : grid;
}

// one text row per pixel row, two characters per pixel: the same 2× scale as the evolution ceremony
function BigPixels({ grid, colors }) {
  return html`
    <${Fragment}>
      ${grid.map(
        (row, r) => html`<${Text} key=${r}>${row.map((p, c) => React.createElement(Text, { key: c, color: colors[p] }, colors[p] ? "██" : "  "))}<//>`
      )}
    <//>
  `;
}

// First launch ever: the dragon hatches. Any key skips ahead; after the reveal, any key starts the quiz.
export function Hatch({ onDone, play = () => {} }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (CRACK_AT.includes(frame)) play("close");
    if (frame === REVEAL_AT) play("evolve");
  }, [frame]);

  const revealed = frame >= REVEAL_AT;
  useInput(() => (revealed ? onDone() : setFrame(REVEAL_AT)));

  const flashing = frame >= FLASH_AT && !revealed;
  const caption = revealed ? "" : frame >= CRACK_AT[0] ? "it's hatching…" : "something stirs inside…";

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${PANEL_WIDTH} alignItems="center">
        <${Text} bold color=${theme.accent}>Dracosh<//>
        <${Box} flexDirection="column" marginTop=${1} alignItems="center">
          ${revealed
            ? html`<${Mascot} stage=${0} face="happy" scale=${2} />`
            : html`<${BigPixels} grid=${eggGrid(frame)} colors=${flashing && frame % 2 === 0 ? FLASH_COLORS : EGG_COLORS} />`}
        <//>
        <${Box} marginTop=${1} flexDirection="column" alignItems="center">
          ${revealed
            ? html`
                <${Fragment}>
                  <${Text} bold color=${theme.good}>Your dragon has hatched!<//>
                  <${Text} dimColor>Answer cards to keep it happy. It grows with your streak.<//>
                <//>
              `
            : html`<${Text} dimColor>${caption}<//>`}
        <//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>${revealed ? "any key to start" : "any key to skip"}<//><//>
    <//>
  `;
}
