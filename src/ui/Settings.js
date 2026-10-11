import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { language, LANGUAGES, t } from "../i18n.js";
import { GOALS, INTERVALS, QUIET_PRESETS, TIP_MODES, VOLUMES, formatInterval } from "../settings.js";
import { formatQuiet } from "../quiet.js";
import { Bar, html, KeyHints, theme, usePanelWidth } from "./kit.js";

function VolumeValue({ value }) {
  return html`<${Text}><${Bar} value=${value} max=${1} width=${10} />  ${Math.round(value * 100)}%<//>`;
}

// label and hint come from settings.rows.<key> in the locale
const ALL_ROWS = [
  { key: "language", options: Object.keys(LANGUAGES), format: (code) => LANGUAGES[code] },
  { key: "everyMs", options: INTERVALS, format: formatInterval },
  { key: "sound", options: [true, false], format: (v) => t(v ? "settings.on" : "settings.off"), toggle: true },
  { key: "volume", options: VOLUMES, format: (v) => html`<${VolumeValue} value=${v} />` },
  { key: "dailyGoal", options: GOALS, format: (n) => t("settings.goal", { n }) },
  { key: "tips", options: TIP_MODES, format: (v) => t(`settings.tipModes.${v}`) },
  { key: "skipWeekends", options: [true, false], format: (v) => t(v ? "settings.weekendsRest" : "settings.weekendsCount"), toggle: true },
  { key: "quiet", options: QUIET_PRESETS, format: formatQuiet },
  { key: "reset", action: true, format: () => t("settings.pressEnter") }
];
const label = (row) => t(`settings.rows.${row.key}.label`);

const nearestIndex = (options, value) => {
  const exact = options.findIndex((option) => JSON.stringify(option) === JSON.stringify(value));
  if (exact >= 0) return exact;
  return options.reduce((best, option, i) => (Math.abs(option - value) < Math.abs(options[best] - value) ? i : best), 0);
};

// Changes apply and persist immediately; there is no save step. Action rows (Reset) open their own
// screen through `onAction`; without it (the preview) they are left out.
export function Settings({ settings, onChange, onClose, onAction }) {
  const panel = usePanelWidth();
  const [row, setRow] = useState(0);
  const ROWS = onAction ? ALL_ROWS : ALL_ROWS.filter((item) => !item.action);
  const values = { ...settings, language: settings.language ?? language() };
  const labelWidth = Math.max(...ROWS.map((item) => label(item).length)) + 2;

  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (key.upArrow) return setRow((r) => Math.max(0, r - 1));
    if (key.downArrow) return setRow((r) => Math.min(ROWS.length - 1, r + 1));

    const current = ROWS[row];
    if (current.action) return key.return ? onAction(current.key) : undefined;
    const direction = key.leftArrow ? -1 : key.rightArrow ? 1 : 0;
    if (current.toggle && (direction || key.return || input === " ")) return onChange({ [current.key]: !values[current.key] });
    if (!direction) return;
    const index = nearestIndex(current.options, values[current.key]);
    const next = current.options[Math.min(current.options.length - 1, Math.max(0, index + direction))];
    if (JSON.stringify(next) !== JSON.stringify(values[current.key])) onChange({ [current.key]: next });
  });

  return html`
    <${Fragment}>
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
      <${Text} bold color=${theme.accent}>${t("settings.title")}<//>
      <${Box} flexDirection="column" marginTop=${1}>
        ${ROWS.map(
          (item, i) => html`
            <${Box} key=${item.key}>
              <${Box} flexShrink=${0}><${Text} color=${i === row ? theme.accent : undefined} bold=${i === row}>${i === row ? "❯" : " "} ${label(item).padEnd(labelWidth)}<//><//>
              <${Text} color=${i === row ? theme.accent : undefined}>${i === row && !item.action ? "❮ " : "  "}${item.format(values[item.key])}${i === row && !item.action ? " ❯" : ""}<//>
            <//>
          `
        )}
      <//>
      <${Box} marginTop=${1}><${Text} dimColor>${t(`settings.rows.${ROWS[row].key}.hint`)}<//><//>
    <//>
    <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.settings")} /><//>
    <//>
  `;
}
