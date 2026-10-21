import { Fragment } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { MAX_FREEZES } from "../progress.js";
import { cellWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

// built at render time, so the texts follow the app language
const keys = () => [
  [t("help.keys.enter"), t("help.keys.enterWhat")],
  [t("help.keys.grade"), t("help.keys.gradeWhat")],
  ["/", t("help.keys.slashWhat")],
  [t("help.keys.esc"), t("help.keys.escWhat")],
  ["q", t("help.keys.qWhat")],
  [t("help.keys.anyKey"), t("help.keys.anyKeyWhat")]
];

const how = () => [
  t("help.how.spacing"),
  t("help.how.typos"),
  t("help.how.cards"),
  t("help.how.streak"),
  t("help.how.freezes", { max: MAX_FREEZES })
];

const outside = () => [
  [`dracosh --deck "${t("help.outside.deckExample")}"`, t("help.outside.deck")],
  ["dracosh --data", t("help.outside.data")],
  ["dracosh restore", t("help.outside.restore")],
  ["dracosh --help", t("help.outside.help")]
];

// the left column fits its longest entry, whatever the language; in a narrow pane each text goes
// under its key instead of into a thin column
const NARROW_TEXT = 24;
function Rows({ rows }) {
  const panel = usePanelWidth();
  const width = Math.max(...rows.map(([left]) => cellWidth(left))) + 2;
  if (panel - 6 - width < NARROW_TEXT)
    return rows.map(
      ([left, right]) => html`
        <${Box} key=${left} flexDirection="column">
          <${Text} color=${theme.accent}>${left}<//>
          <${Box} marginLeft=${2}><${Text}>${right}<//><//>
        <//>
      `
    );
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

// How Dracosh works, on one screen: the keys, the rules behind the spacing and the streak,
// and what you can do from the shell.
export function Help({ onClose }) {
  const panel = usePanelWidth();
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") onClose();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("help.title")}<//>
        <${Section} title=${t("help.keysTitle")}><${Rows} rows=${keys()} /><//>
        <${Section} title=${t("help.howTitle")}>
          ${how().map((line) => html`<${Box} key=${line}><${Box} width=${2} flexShrink=${0}><${Text} dimColor>·<//><//><${Text}>${line}<//><//>`)}
        <//>
        <${Section} title=${t("help.outsideTitle")}><${Rows} rows=${outside()} /><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.back")} /><//>
    <//>
  `;
}
