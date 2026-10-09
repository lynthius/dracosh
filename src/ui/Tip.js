import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, PANEL_WIDTH, theme } from "./kit.js";

// A full-screen grammar tip; Enter or → shows another one.
export function Tip({ nextTip, onClose }) {
  const [tip, setTip] = useState(() => nextTip());
  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (key.return || key.rightArrow || input === " ") setTip(nextTip());
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Box}>
          <${Text} bold color=${theme.accent}>Grammar tip<//>
          <${Text} dimColor>  ${tip.cat}<//>
        <//>
        <${Box} marginTop=${1}><${Text}>${tip.text}<//><//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>enter or → another tip · esc back<//><//>
    <//>
  `;
}
