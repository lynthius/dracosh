import { html } from "./kit.js";
import { PixelGrid } from "./Mascot.js";

// 8×8 pixel icons for the badge groups, drawn with the same half-block technique as the mascot.
// Letters are per-icon palette keys; "." is transparent.
const ICONS = {
  trophy: {
    palette: { G: "#fcd34d", D: "#b45309", W: "#fef3c7" },
    grid: [
      ".GGGGGG.",
      "GDGWGGDG",
      "GDGGGGDG",
      ".DGGGGD.",
      "..DGGD..",
      "...GG...",
      "..DGGD..",
      ".GGGGGG."
    ]
  },
  flame: {
    palette: { R: "#f97316", Y: "#fbbf24", W: "#fef3c7" },
    grid: [
      "...R....",
      "...RR.R.",
      "..RRRR..",
      ".RRYYRR.",
      ".RYYYYR.",
      ".RYWWYR.",
      "..YWWY..",
      "...YY..."
    ]
  },
  book: {
    palette: { B: "#9d7cd8", D: "#6b4fa0", W: "#efe6f7", L: "#cbb8e8" },
    grid: [
      "........",
      ".BBBBBB.",
      "DBWWWWB.",
      "DBWLLWB.",
      "DBWWWWB.",
      "DBWLLWB.",
      ".BBBBBB.",
      "........"
    ]
  },
  star: {
    palette: { S: "#fbbf24", W: "#fef3c7" },
    grid: [
      "...S....",
      "..SSS...",
      "SSSWSSS.",
      ".SSWSS..",
      "..SSS...",
      ".SS.SS..",
      "SS...SS.",
      "........"
    ]
  },
  bolt: {
    palette: { Y: "#fbbf24", W: "#fef3c7" },
    grid: [
      "...YYY..",
      "..YYY...",
      ".YYYYY..",
      "...YWY..",
      "..YYY...",
      ".YYY....",
      ".YY.....",
      "Y......."
    ]
  },
  sun: {
    palette: { Y: "#fbbf24", O: "#f97316" },
    grid: [
      "Y..YY..Y",
      "..YYYY..",
      ".YYOOYY.",
      "YYOOOOYY",
      "YYOOOOYY",
      ".YYOOYY.",
      "..YYYY..",
      "Y..YY..Y"
    ]
  },
  moon: {
    palette: { M: "#7dd3fc", W: "#fef3c7" },
    grid: [
      "...MMM..",
      "..MM..W.",
      ".MM.....",
      ".MM.....",
      ".MM...W.",
      "..MM....",
      "...MMM..",
      "........"
    ]
  },
  calendar: {
    palette: { C: "#9aa4b2", R: "#f87171", W: "#f4f4f5", G: "#4ade80" },
    grid: [
      ".C.CC.C.",
      "RRRRRRRR",
      "CWWWWWWC",
      "CWGWGWWC",
      "CWWWWWWC",
      "CWGWWGWC",
      "CCCCCCCC",
      "........"
    ]
  },
  snowflake: {
    palette: { I: "#7dd3fc", W: "#e0f2fe" },
    grid: [
      "...I....",
      ".I.I.I..",
      "..IWI...",
      "IIIWIII.",
      "..IWI...",
      ".I.I.I..",
      "...I....",
      "........"
    ]
  },
  arrows: {
    palette: { A: "#4ade80", B: "#9d7cd8" },
    grid: [
      "..A.....",
      ".AA.....",
      "AAAAAAA.",
      ".AA.....",
      ".....BB.",
      ".BBBBBBB",
      ".....BB.",
      "....B..."
    ]
  },
  heart: {
    palette: { H: "#f87171", W: "#fecaca" },
    grid: [
      "........",
      ".HH..HH.",
      "HWHHHHHH",
      "HWHHHHHH",
      ".HHHHHH.",
      "..HHHH..",
      "...HH...",
      "........"
    ]
  },
  compass: {
    palette: { C: "#9aa4b2", W: "#f4f4f5", R: "#f87171", B: "#64748b" },
    grid: [
      "..CCCC..",
      ".CWWWWC.",
      "CWWWRWWC",
      "CWWRRWWC",
      "CWWBBWWC",
      ".CWBWWC.",
      "..CCCC..",
      "........"
    ]
  }
};

// which icon each badge gets, by badge id
const ICON_FOR = {
  hello: "trophy",
  "first-steps": "trophy",
  century: "trophy",
  "five-hundred": "trophy",
  thousand: "trophy",
  "two-thousand": "trophy",
  "on-a-roll": "flame",
  week: "flame",
  fortnight: "flame",
  month: "flame",
  "hundred-days": "flame",
  keeper: "book",
  collector: "book",
  dictionary: "book",
  explorer: "compass",
  flawless: "star",
  overachiever: "star",
  marathon: "star",
  "hot-streak": "bolt",
  unstoppable: "bolt",
  "combo-master": "bolt",
  "early-bird": "sun",
  "night-owl": "moon",
  comeback: "heart",
  redemption: "heart",
  frozen: "snowflake",
  weekend: "calendar",
  "perfect-week": "calendar",
  regular: "calendar",
  machine: "calendar",
  "hundred-club": "calendar",
  "both-ways": "arrows"
};

const LOCKED_COLOR = "#4a5058";

export function BadgeIcon({ id, locked = false }) {
  const icon = ICONS[ICON_FOR[id]] ?? ICONS.star;
  const palette = locked ? Object.fromEntries(Object.keys(icon.palette).map((k) => [k, LOCKED_COLOR])) : icon.palette;
  return html`<${PixelGrid} grid=${icon.grid.map((row) => [...row])} palette=${palette} />`;
}

export const ICON_WIDTH = 8;
