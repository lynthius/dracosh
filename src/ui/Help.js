import { Fragment } from "react";
import { Box, Text, useInput } from "ink";
import { MAX_FREEZES } from "../progress.js";
import { BOX_INTERVALS_DAYS } from "../scheduler.js";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";

const KEYS = [
  ["Enter", "submit your answer (empty shows the answer); between cards, ask the next one"],
  ["/", "open the commands"],
  ["Esc", "clear what you typed, or quit"],
  ["q", "quit, between cards"],
  ["any key", "wakes a sleeping dragon"]
];

const HOW = [
  `A right answer moves a card to a later box: it comes back in ${BOX_INTERVALS_DAYS.slice(0, -1).join(", ")}, then ${BOX_INTERVALS_DAYS.at(-1)} days. A miss sends it back to the first box.`,
  "One wrong letter in a longer word still counts, and you see the right spelling.",
  "Reach your daily goal to keep your streak going; a day where you did every card there was counts too. Your dragon grows with your best streak.",
  `A freeze covers a day you missed. You start with ${MAX_FREEZES} and get one back each week, ${MAX_FREEZES} at most.`
];

const OUTSIDE = [
  ['dracosh --deck "Polish"', "quiz another deck"],
  ["dracosh --data", "where your cards and backups are"],
  ["dracosh restore", "bring back a backup"],
  ["dracosh --help", "every option"]
];

function Rows({ rows, width }) {
  return rows.map(
    ([left, right]) => html`
      <${Box} key=${left}>
        <${Box} width=${width} flexShrink=${0}><${Text} color=${theme.accent}>${left}<//><//>
        <${Text}>${right}<//>
      <//>
    `
  );
}

const Section = ({ title, children }) => html`
  <${Box} flexDirection="column" marginTop=${1}>
    <${Text} bold>${title}<//>
    ${children}
  <//>
`;

// How Dracosh works, on one screen: the keys, the rules behind the boxes and the streak,
// and what you can do from the shell.
export function Help({ onClose }) {
  const panel = usePanelWidth();
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") onClose();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>Help<//>
        <${Section} title="Keys"><${Rows} rows=${KEYS} width=${10} /><//>
        <${Section} title="How it works">
          ${HOW.map((line) => html`<${Box} key=${line}><${Box} width=${2} flexShrink=${0}><${Text} dimColor>·<//><//><${Text}>${line}<//><//>`)}
        <//>
        <${Section} title="Outside the quiz"><${Rows} rows=${OUTSIDE} width=${26} /><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="esc back" /><//>
    <//>
  `;
}
