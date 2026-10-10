import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, KeyHints, PANEL_WIDTH, theme } from "./kit.js";

const MAX_ROWS = 10;

const dayLabel = (offset, date) => (offset === 0 ? "today" : offset === -1 ? `yesterday · ${date}` : date);

// Words you got wrong on a day, with what you typed and whether you got them right afterwards.
export function Missed({ getMissed, onClose }) {
  const [offset, setOffset] = useState(0);
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") return onClose();
    if (key.leftArrow) return setOffset((o) => o - 1);
    if (key.rightArrow) return setOffset((o) => Math.min(0, o + 1));
  });

  const { date, items } = getMissed(offset);
  const shown = items.slice(0, MAX_ROWS);

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Box}>
          <${Text} bold color=${theme.accent}>Missed<//>
          <${Text} dimColor>  ${dayLabel(offset, date)} · ${items.length} card${items.length === 1 ? "" : "s"}<//>
        <//>
        ${items.length === 0
          ? html`<${Box} marginTop=${1}><${Text} dimColor>${offset === 0 ? "Nothing missed so far today." : "Nothing missed that day."}<//><//>`
          : html`
              <${Box} flexDirection="column" marginTop=${1}>
                ${shown.map(
                  (item) => html`
                    <${Box} key=${item.key} flexDirection="column" marginBottom=${1}>
                      <${Text}>
                        <${Text} color=${item.recovered ? theme.good : theme.bad} bold>${item.recovered ? "✓" : "✗"}<//>
                        <${Text} bold>  ${item.prompt}<//>
                        <${Text} dimColor>  ${item.label}${item.times > 1 ? ` · missed ${item.times}×` : ""}<//>
                      <//>
                      <${Text}>   ${item.expected.join(", ")}<//>
                      <${Text} dimColor>   ${item.answer ? `you wrote: ${item.answer}` : "no answer"}${item.recovered ? " · got it right since" : ""}<//>
                    <//>
                  `
                )}
                ${items.length > MAX_ROWS && html`<${Text} dimColor>…and ${items.length - MAX_ROWS} more<//>`}
              <//>
            `}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="←/→ day · esc back" /><//>
    <//>
  `;
}
