import { Box, Text, useInput } from "ink";
import { html, theme } from "./kit.js";

// A question's answers as a list: ↑/↓ and Enter, a number, or an option's own key ("y", "n").
// Each option: { label, note?, key?, danger? }; `danger` paints it red while it's chosen.
export function Choice({ options, selected, onMove, onPick, onCancel }) {
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.upArrow) return onMove(Math.max(0, selected - 1));
    if (key.downArrow) return onMove(Math.min(options.length - 1, selected + 1));
    if (key.return) return onPick(selected);
    const index = options.findIndex((o, i) => input === String(i + 1) || (o.key && input.toLowerCase() === o.key));
    if (index >= 0) onPick(index);
  });

  const width = Math.max(...options.map((o) => o.label.length)) + 2;
  return html`
    <${Box} flexDirection="column">
      ${options.map((o, i) => {
        const on = i === selected;
        const color = on ? (o.danger ? theme.bad : theme.accent) : undefined;
        return html`
          <${Box} key=${o.label}>
            <${Box} flexShrink=${0}><${Text} color=${color} bold=${on}>${on ? "❯" : " "} ${i + 1}. ${o.label.padEnd(width)}<//><//>
            ${o.note && html`<${Text} dimColor>${o.note}<//>`}
          <//>
        `;
      })}
    <//>
  `;
}

export const CHOICE_KEYS = "↑/↓ choose · enter confirm";
