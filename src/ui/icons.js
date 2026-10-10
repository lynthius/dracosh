import { Text } from "ink";
import { BADGES } from "../progress.js";
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
    palette: { S: "#fbbf24", W: "#fef3c7", R: "#60a5fa" },
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
      ".MM.....",
      ".MM.....",
      "..MM..W.",
      "...MMM.."
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

// the ring for the badge that needs every other one
ICONS.ring = {
  palette: { G: "#fcd34d", D: "#b45309", W: "#fef9c3" },
  grid: [
    "..GGGG..",
    ".GW..GG.",
    "GW....DG",
    "G......G",
    "G......G",
    "GG....DG",
    ".GD..DG.",
    "..DDDD.."
  ]
};

export const RING = ICONS.ring;

// "Dragon's die": a die showing five
ICONS.die = {
  palette: { W: "#f4f4f5", D: "#c7c9d1", P: "#2a2440" },
  grid: [
    ".WWWWWW.",
    "WPPWWPPW",
    "WPPWWPPW",
    "WWWPPWWD",
    "WWWPPWWD",
    "WPPWWPPD",
    "WPPWWPPD",
    ".DDDDDD."
  ]
};

// what a hidden badge shows until it's won
ICONS.secret = {
  palette: { Q: "#6b7280" },
  grid: [
    "..QQQQ..",
    ".QQ..QQ.",
    ".....QQ.",
    "....QQ..",
    "...QQ...",
    "...QQ...",
    "........",
    "...QQ..."
  ]
};

// which icon each badge gets, by badge id
const ICON_FOR = {
  hello: "trophy",
  "first-steps": "trophy",
  century: "trophy",
  thousand: "trophy",
  "five-thousand": "trophy",
  "ten-thousand": "trophy",
  "dragons-hoard": "trophy",
  "on-a-roll": "flame",
  week: "flame",
  fortnight: "flame",
  month: "flame",
  "hundred-days": "flame",
  dragonheart: "flame",
  keeper: "book",
  collector: "book",
  dictionary: "book",
  lexicon: "book",
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
  "one-ring": "ring",
  "dragons-die": "die"
};

const LOCKED_COLOR = "#4a5058";

// Rank colors for the badge groups that climb (more answers, longer streaks…): the higher, the rarer.
const TIERS = [
  { name: "bronze", main: "#d08a4e", shade: "#8a4f1c", light: "#f3c9a0" },
  { name: "silver", main: "#c9d1d9", shade: "#7d8794", light: "#ffffff" },
  { name: "gold", main: "#fcd34d", shade: "#b45309", light: "#fef3c7" },
  { name: "emerald", main: "#34d399", shade: "#047857", light: "#d1fae5" },
  { name: "diamond", main: "#7dd3fc", shade: "#2b6f99", light: "#e0f2fe" },
  { name: "amethyst", main: "#c084fc", shade: "#6b21a8", light: "#f3e8ff" },
  { name: "ruby", main: "#f87171", shade: "#991b1b", light: "#fee2e2" }
];
// Badges that share an icon but need telling apart get their own grid: the calendars mark the days
// each one asks for, from a weekend to a month nearly full; the day badges are a star (no miss),
// a crown (double the goal) and a medal (a marathon); a heart with a mended crack is a mistake put right.
const CALENDAR_PAGE = (days) => [".C.CC.C.", "RRRRRRRR", ...days.map((row) => `C${row}C`), "CCCCCCCC", "........"];
const OWN_GRIDS = {
  weekend: CALENDAR_PAGE(["WWWWWW", "WWWWGG", "WWWWWW", "WWWWGG"]),
  "perfect-week": CALENDAR_PAGE(["WWWWWW", "GGGGGG", "WWWWWW", "WWWWWW"]),
  regular: CALENDAR_PAGE(["GWGGWG", "GGWGGW", "WGGWGG", "WWWWWW"]),
  machine: CALENDAR_PAGE(["GGGGGG", "GGGGWG", "GGGGGG", "GGWWWW"]),
  "hundred-club": CALENDAR_PAGE(["GGGGGG", "GGGGGG", "GGGGGG", "GGGGGG"]),
  overachiever: [
    "........",
    "W..W..W.",
    "S..S..S.",
    "SS.S.SS.",
    "SSSSSSS.",
    "SRSWSRS.",
    "SSSSSSS.",
    "........"
  ],
  marathon: [
    "RR....RR",
    ".RR..RR.",
    "..RRRR..",
    "..SSSS..",
    ".SSWSSS.",
    ".SWSSSS.",
    ".SSSSSS.",
    "..SSSS.."
  ],
  redemption: [
    "........",
    ".HH..HH.",
    "HWH.HHHH",
    "HWHH.HHH",
    ".HH.HHH.",
    "..HH.H..",
    "...HH...",
    "........"
  ]
};

// which palette letters of a tiered icon take the tier's main / shade / light color
const TIER_ROLES = {
  trophy: { G: "main", D: "shade", W: "light" },
  flame: { Y: "main", R: "shade", W: "light" },
  book: { B: "main", D: "shade" },
  bolt: { Y: "main", W: "light" },
  calendar: { R: "main" }
};

// the badge's rank within its group, in the order BADGES lists them (easiest first); null if the group isn't tiered
function tierOf(id) {
  const icon = ICON_FOR[id];
  if (!TIER_ROLES[icon]) return null;
  const group = BADGES.filter((badge) => ICON_FOR[badge.id] === icon).map((badge) => badge.id);
  return TIERS[Math.min(group.indexOf(id), TIERS.length - 1)];
}

function paletteFor(id, icon) {
  const tier = tierOf(id);
  if (!tier) return icon.palette;
  const roles = TIER_ROLES[ICON_FOR[id]];
  return Object.fromEntries(Object.entries(icon.palette).map(([key, color]) => [key, roles[key] ? tier[roles[key]] : color]));
}

// the color that stands for an unlocked badge in lists: its rank color, or gold for untiered ones
export const badgeColor = (id) => tierOf(id)?.main ?? TIERS[2].main;

const fillIn = (row) => row.replace(/(?<=[^.].*)\.(?=.*[^.])/g, "G");

// `locked` greys the icon out; `flash` whites it out (a frame of a badge lighting up in /badges);
// `secret` replaces a hidden badge that isn't won yet with a question mark
export function BadgeIcon({ id, locked = false, flash = false, secret = false }) {
  if (secret) return html`<${PixelGrid} grid=${ICONS.secret.grid.map((row) => [...row])} palette=${ICONS.secret.palette} />`;
  const icon = ICONS[ICON_FOR[id]] ?? ICONS.star;
  const flat = (color) => Object.fromEntries(Object.keys(icon.palette).map((k) => [k, color]));
  const palette = flash ? flat("#ffffff") : locked ? flat(LOCKED_COLOR) : paletteFor(id, icon);
  // a locked ring is drawn filled in, so its silhouette doesn't give away what it is
  const own = OWN_GRIDS[id] ?? icon.grid;
  const grid = locked && !flash && id === "one-ring" ? own.map(fillIn) : own;
  return html`<${PixelGrid} grid=${grid.map((row) => [...row])} palette=${palette} />`;
}

// The streak flame: a small triangle in fire orange, the height of the letters next to it.
// (Pixel blocks fill the whole line height and look too big beside text.)
export const Flame = () => html`<${Text} color="#f97316">▴<//>`;

export const ICON_WIDTH = 8;
