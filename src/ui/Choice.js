import { useRef } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { cellWidth, html, Text, theme, usePanelWidth } from "./kit.js";

// A question's answers as a list: ↑/↓ and Enter, a number, or an option's own keys ("t|y" in Polish).
// Each option: { label, note?, key?, danger? }; `danger` paints it red while it's chosen.
const SETTLE_MS = 300; // a pick right after the list appears is the second half of the Enter before it

export function Choice({ options, selected, onMove, onPick, onCancel }) {
  const shownAt = useRef(Date.now());
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.upArrow) return onMove(Math.max(0, selected - 1));
    if (key.downArrow) return onMove(Math.min(options.length - 1, selected + 1));
    if (Date.now() - shownAt.current < SETTLE_MS && (key.return || /^\d$/.test(input))) return;
    if (key.return) return onPick(selected);
    const index = options.findIndex((o, i) => input === String(i + 1) || (o.key && o.key.split("|").includes(input.toLowerCase())));
    if (index >= 0) onPick(index);
  });

  const panel = usePanelWidth();
  const width = Math.max(...options.map((o) => cellWidth(o.label))) + 2;
  // in a narrow pane the notes go under their labels instead of wrapping into a thin column
  const stacked = options.some((o) => o.note && 5 + width + cellWidth(o.note) > panel - 6);
  return html`
    <${Box} flexDirection="column">
      ${options.map((o, i) => {
        const on = i === selected;
        const color = on ? (o.danger ? theme.bad : theme.accent) : undefined;
        return html`
          <${Box} key=${`${i}:${o.label}`} flexDirection=${stacked ? "column" : "row"}>
            <${Box} flexShrink=${0}><${Text} color=${color} bold=${on}>${on ? "❯" : " "} ${i + 1}. ${stacked ? o.label : o.label + " ".repeat(width - cellWidth(o.label))}<//><//>
            ${o.note && html`<${Box} marginLeft=${stacked ? 5 : 0}><${Text} dimColor>${o.note}<//><//>`}
          <//>
        `;
      })}
    <//>
  `;
}

// the footer under a list of choices; `end` is what Esc does there ("back" or "cancel")
export const choiceHints = (end = "back") => t(end === "cancel" ? "keyHints.choiceCancel" : "keyHints.choiceBack", { choose: t("choice.keys") });
