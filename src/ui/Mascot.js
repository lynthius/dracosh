import React from "react";
import { Text } from "ink";
import { html } from "./kit.js";

// A tiny flashcard creature, drawn as pixels: every text row stacks two pixel rows using half blocks (▀ ▄ █).
// Proper pixel art: O = dark outline, L = top highlight, B = body, D = bottom shade.
// Its form (accessories) comes from the evolution stage, its expression from how you are doing.
const WIDTH = 12;
const BASE = [
  "............",
  "..OOOOOOOO..",
  ".OLLLLLLLLO.",
  ".OBBEBBEBBO.",
  ".OBBEBBEBBO.",
  ".OBBBBBBBBO.",
  ".ODBBBBBBDO.",
  "..OOOOOOOO..",
  "...OO..OO...",
  "............"
];

// a little green dragon: scale-green body, cream belly, bone horns, golden spikes
const PALETTES = {
  normal: { B: "#58a66d", L: "#8ed49a", D: "#3d7a4d", O: "#1e3b27", E: "#132019", C: "#f2a9b8", T: "#7dd3fc" },
  // two hot variants: alternating them per tick makes the combo glow flicker like dragon fire
  hot: { B: "#fbbf24", L: "#fde68a", D: "#d97706", O: "#7c4a03", E: "#3b2300", C: "#fef3c7", T: "#7dd3fc" },
  hot2: { B: "#f59e0b", L: "#fcd34d", D: "#c2610a", O: "#6b3f03", E: "#3b2300", C: "#fde68a", T: "#7dd3fc" },
  // the white-out frames of the evolution ceremony
  flash: { B: "#eaf6ec", L: "#ffffff", D: "#cfe6d4", O: "#9db8a4", E: "#eaf6ec", C: "#ffffff", T: "#ffffff" }
};
const ACCESSORY_COLORS = { H: "#e8dcc8", W: "#2f6b45", P: "#e6d79a", S: "#d9a441", G: "#fcd34d" };
const FLASH_ACCESSORIES = { H: "#ffffff", W: "#cfe6d4", P: "#ffffff", S: "#ffffff", G: "#ffffff" };

// The dragon's element, rolled once with "Dragon's die": its own body and accessory colors, plus a few
// details (X, Y) drawn before the evolution accessories, so horns, wings and the halo always show.
const ELEMENT_LOOKS = {
  earth: {
    body: { B: "#8b6d47", L: "#b8955f", D: "#5e4630", O: "#2e2216" },
    accents: { H: "#d9cbb0", W: "#4d6b35", P: "#c9b48a", S: "#7a8f3d" },
    colors: { X: "#7fb045", Y: "#6b5a44" },
    details: [[2, 3, "X"], [2, 4, "X"], [2, 8, "X"], [6, 2, "Y"], [6, 9, "Y"]] // moss on the head, pebbles below
  },
  wind: {
    body: { B: "#a8d8cf", L: "#e0f5f0", D: "#76b0a6", O: "#3a5f59" },
    accents: { H: "#ffffff", W: "#cfeee8", P: "#e0f5f0", S: "#ffffff" },
    colors: { X: "#e6fffb" },
    details: [[1, 0, "X"], [1, 1, "X"], [8, 0, "X"], [8, 11, "X"]] // wisps of air around it
  },
  water: {
    body: { B: "#3b82c4", L: "#7cb8e8", D: "#245d94", O: "#13304d" },
    accents: { H: "#cfe8ff", W: "#1e5a8f", P: "#a5d3f5", S: "#7cb8e8" },
    colors: { X: "#5fb3f0", Y: "#bfe3ff" },
    details: [[1, 5, "X"], [1, 6, "X"], [1, 11, "Y"]] // a fin on the head, a drop of water
  },
  ice: {
    body: { B: "#bfe6f5", L: "#ffffff", D: "#86c0d8", O: "#3d6f86" },
    accents: { H: "#e0f7ff", W: "#86c0d8", P: "#ffffff", S: "#e0f7ff" },
    colors: { X: "#e0f7ff", Y: "#ffffff" },
    details: [[0, 2, "X"], [0, 9, "X"], [6, 3, "Y"], [6, 8, "Y"]] // crystal spikes, frost
  },
  fire: {
    body: { B: "#e4572e", L: "#f59e5b", D: "#a8341c", O: "#4a140a" },
    accents: { H: "#fde68a", W: "#a8341c", P: "#fbbf24", S: "#fbbf24" },
    colors: { X: "#fbbf24", Y: "#fde68a" },
    details: [[0, 4, "X"], [0, 7, "X"], [1, 0, "Y"], [1, 11, "Y"]] // flame tips, embers
  },
  cosmos: {
    body: { B: "#3b2f7a", L: "#5b4bb0", D: "#30266a", O: "#2a2163", E: "#e0e7ff", C: "#c084fc" },
    accents: { H: "#c4b5fd", W: "#261d55", P: "#5b4bb0", S: "#c4b5fd" },
    colors: { X: "#fef3c7" },
    details: [[2, 2, "X"], [2, 9, "X"], [5, 9, "X"], [6, 2, "X"]] // stars on its body, glowing eyes
  }
};

// What each evolution stage adds on top of the previous one: [row, col, pixel]
const STAGE_EDITS = [
  [], // 0 Hatchling
  [[0, 3, "H"], [1, 3, "H"], [0, 8, "H"], [1, 8, "H"]], // 1 Imp: horns
  [[3, 0, "W"], [4, 0, "W"], [3, 11, "W"], [4, 11, "W"]], // 2 Whelp: little wings
  [[5, 4, "P"], [5, 5, "P"], [5, 6, "P"], [5, 7, "P"], [6, 4, "P"], [6, 5, "P"], [6, 6, "P"], [6, 7, "P"], [6, 11, "W"], [7, 10, "W"]], // 3 Drake: belly and tail
  [[0, 5, "S"], [0, 6, "S"], [2, 0, "W"], [2, 11, "W"], [5, 0, "W"], [5, 11, "W"]], // 4 Dragon: head spikes, bigger wings
  [[0, 4, "G"], [0, 5, "G"], [0, 6, "G"], [0, 7, "G"]] // 5 Legend: halo (and golden horns, see below)
];
const LEGEND = STAGE_EDITS.length - 1;

const OPEN_EYES = []; // the base already has them
const SHUT_EYES = [[3, 4, "B"], [3, 7, "B"]]; // only the lower eye pixel stays: half-closed
const SMILE = [[5, 4, "E"], [6, 5, "E"], [6, 6, "E"], [5, 7, "E"]];
const GRIN = [[5, 4, "E"], [5, 7, "E"], [6, 4, "E"], [6, 5, "E"], [6, 6, "E"], [6, 7, "E"]];
const FROWN = [[6, 4, "E"], [5, 5, "E"], [5, 6, "E"], [6, 7, "E"]];

// [row, col, pixel] edits for each expression, applied last
const FACES = {
  idle: [...OPEN_EYES, [5, 5, "E"], [5, 6, "E"]], // straight little mouth
  blink: [...SHUT_EYES, [5, 5, "E"], [5, 6, "E"]],
  smile: SMILE, // content: today's goal is done
  happy: [...SHUT_EYES, ...GRIN, [4, 2, "C"], [4, 9, "C"]], // beaming, with blushing cheeks
  sad: [...FROWN, [5, 8, "T"]], // a tear under the right eye
  sleep: [...SHUT_EYES] // eyes shut, mouth relaxed away
};

// `shift` nudges the whole grid by dx columns / dy pixel rows (half a text row) for jump and shake frames
export function drawSprite(face, stage = 0, { dx = 0, dy = 0, element = null } = {}) {
  const grid = BASE.map((row) => [...row]);
  const apply = (edits) => edits.forEach(([r, c, pixel]) => (grid[r][c] = pixel));
  if (ELEMENT_LOOKS[element]) apply(ELEMENT_LOOKS[element].details);
  STAGE_EDITS.slice(0, stage + 1).forEach(apply);
  apply(FACES[face] ?? FACES.idle);
  if (!dx && !dy) return grid;
  return grid.map((_, r) => grid[r].map((_, c) => grid[r + dy]?.[c + dx] ?? "."));
}

// one text row from two stacked pixel rows
function cell(top, bottom, palette, key) {
  const t = palette[top];
  const b = palette[bottom];
  if (!t && !b) return React.createElement(Text, { key }, " ");
  if (t && !b) return React.createElement(Text, { key, color: t }, "▀");
  if (!t && b) return React.createElement(Text, { key, color: b }, "▄");
  if (t === b) return React.createElement(Text, { key, color: t }, "█");
  return React.createElement(Text, { key, color: t, backgroundColor: b }, "▀");
}

// Any pixel-letter grid rendered with half blocks; the mascot and the badge icons share it.
export function PixelGrid({ grid, palette }) {
  const rows = [];
  for (let r = 0; r < grid.length; r += 2) {
    const cells = [];
    for (let c = 0; c < grid[r].length; c++) cells.push(cell(grid[r][c], grid[r + 1]?.[c], palette, c));
    rows.push(html`<${Text} key=${r}>${cells}<//>`);
  }
  return html`<${React.Fragment}>${rows}<//>`;
}

// A form you haven't reached: one flat color, no eyes or shading, so only the outline gives it away
const SILHOUETTE = "#2c3038";
const LOCKED = Object.fromEntries([..."BLDOECTHWPSGXY"].map((key) => [key, SILHOUETTE]));

function paletteFor({ locked, flash, hot, flicker, stage, element }) {
  if (locked) return LOCKED;
  if (flash) return { ...FLASH_ACCESSORIES, ...PALETTES.flash, X: "#ffffff", Y: "#ffffff" };
  const look = ELEMENT_LOOKS[element];
  const body = hot ? (flicker ? PALETTES.hot2 : PALETTES.hot) : { ...PALETTES.normal, ...look?.body };
  const palette = { ...ACCESSORY_COLORS, ...look?.accents, ...look?.colors, ...body };
  if (stage >= LEGEND) palette.H = ACCESSORY_COLORS.G; // Legend: golden horns under the halo
  return palette;
}

// `locked` draws a dark silhouette (a form you haven't reached yet); `flash` whites it out (evolution);
// `flicker` alternates the hot palette; `scale: 2` draws one text row per pixel row, two chars per pixel.
// `element` is the dragon's rolled element ("earth" … "cosmos"), or null for the default green dragon
export function Mascot({ face = "idle", hot = false, stage = 0, locked = false, flash = false, flicker = false, scale = 1, dx = 0, dy = 0, element = null }) {
  const palette = paletteFor({ locked, flash, hot, flicker, stage, element });
  const grid = drawSprite(face, stage, { dx, dy, element });
  const rows = [];
  if (scale === 2) {
    for (let r = 0; r < grid.length; r++) {
      const cells = grid[r].map((pixel, c) => {
        const color = palette[pixel];
        return React.createElement(Text, { key: c, color }, color ? "██" : "  ");
      });
      rows.push(html`<${Text} key=${r}>${cells}<//>`);
    }
  } else {
    for (let r = 0; r < grid.length; r += 2) {
      const cells = [];
      for (let c = 0; c < WIDTH; c++) cells.push(cell(grid[r][c], grid[r + 1][c], palette, c));
      rows.push(html`<${Text} key=${r}>${cells}<//>`);
    }
  }
  return html`<${React.Fragment}>${rows}<//>`;
}

export const MASCOT_WIDTH = WIDTH;
