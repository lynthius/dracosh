import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { DIRECTION_LABELS, DIRECTION_OPTIONS, GOALS, INTERVALS, QUIET_PRESETS, TIP_LABELS, TIP_MODES, VOLUMES, formatInterval } from "../settings.js";
import { formatQuiet } from "../quiet.js";
import { Bar, html, PANEL_WIDTH, theme } from "./kit.js";

function VolumeValue({ value }) {
  return html`<${Text}><${Bar} value=${value} max=${1} width=${10} />  ${Math.round(value * 100)}%<//>`;
}

const ROWS = [
  { key: "everyMs", label: "Interval", options: INTERVALS, format: formatInterval, hint: "time between questions" },
  { key: "sound", label: "Sound", options: [true, false], format: (v) => (v ? "on" : "off"), hint: "answer and new-word sounds", toggle: true },
  { key: "volume", label: "Volume", options: VOLUMES, format: (v) => html`<${VolumeValue} value=${v} />`, hint: "plays a preview when changed" },
  { key: "dailyGoal", label: "Daily goal", options: GOALS, format: (n) => `${n} correct`, hint: "keeps your streak alive" },
  { key: "tips", label: "Tips", options: TIP_MODES, format: (v) => TIP_LABELS[v], hint: "a short tip about Dracosh while you wait (or /tip any time)" },
  { key: "skipWeekends", label: "Weekends", options: [true, false], format: (v) => (v ? "rest days" : "count like other days"), hint: "rest days never break your streak (doing them still counts)", toggle: true },
  { key: "quiet", label: "Quiet hours", options: QUIET_PRESETS, format: formatQuiet, hint: "no questions, sounds or banners during these hours" },
  { key: "directions", label: "Direction", options: DIRECTION_OPTIONS, format: (v) => DIRECTION_LABELS[v], hint: "which way to ask" }
];

const nearestIndex = (options, value) => {
  const exact = options.findIndex((option) => JSON.stringify(option) === JSON.stringify(value));
  if (exact >= 0) return exact;
  return options.reduce((best, option, i) => (Math.abs(option - value) < Math.abs(options[best] - value) ? i : best), 0);
};

// Changes apply and persist immediately; there is no save step.
export function Settings({ settings, onChange, onClose }) {
  const [row, setRow] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (key.upArrow) return setRow((r) => Math.max(0, r - 1));
    if (key.downArrow) return setRow((r) => Math.min(ROWS.length - 1, r + 1));

    const current = ROWS[row];
    const direction = key.leftArrow ? -1 : key.rightArrow ? 1 : 0;
    if (current.toggle && (direction || key.return || input === " ")) return onChange({ [current.key]: !settings[current.key] });
    if (!direction) return;
    const index = nearestIndex(current.options, settings[current.key]);
    const next = current.options[Math.min(current.options.length - 1, Math.max(0, index + direction))];
    if (JSON.stringify(next) !== JSON.stringify(settings[current.key])) onChange({ [current.key]: next });
  });

  return html`
    <${Fragment}>
    <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
      <${Text} bold color=${theme.accent}>Settings<//>
      <${Box} flexDirection="column" marginTop=${1}>
        ${ROWS.map(
          (item, i) => html`
            <${Box} key=${item.key}>
              <${Text} color=${i === row ? theme.accent : undefined} bold=${i === row}>${i === row ? "❯" : " "} ${item.label.padEnd(13)}<//>
              <${Text} color=${i === row ? theme.accent : undefined}>${i === row ? "❮ " : "  "}${item.format(settings[item.key])}${i === row ? " ❯" : ""}<//>
            <//>
          `
        )}
      <//>
      <${Box} marginTop=${1}><${Text} dimColor>${ROWS[row].hint}<//><//>
    <//>
    <${Box} paddingX=${1}><${Text} dimColor>↑/↓ select · ←/→ change · esc back<//><//>
    <//>
  `;
}
