import { Fragment } from "react";
import { Box, Text, useInput } from "ink";
import { ELEMENT_ADJECTIVE, STAGES } from "../progress.js";
import { html, PANEL_WIDTH, theme } from "./kit.js";
import { ELEMENT_COLOR, Mascot } from "./Mascot.js";

const requirement = (stage, locked) => (stage.from === 0 ? "from the start" : `${locked ? "needs " : ""}${stage.from} days`);

// Every form of the companion. Forms you haven't reached are flat silhouettes named "???".
// Its moods aren't listed here on purpose: you find them out by playing.
export function Companion({ current, best, element = null, roll = null, onClose }) {
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") onClose();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} bold color=${theme.accent}>Companion<//>
        <${Box} marginTop=${1}>
          <${Text}>Your dragon: <//>
          ${element && html`<${Text} bold color=${ELEMENT_COLOR[element]}>${ELEMENT_ADJECTIVE[element]} <//>`}
          <${Text} bold>${STAGES[current].name}<//>
        <//>
        <${Text} dimColor>${element ? `Element: ${element}${roll ? ` · rolled a ${roll.face} on Dragon's die, ${roll.on}` : ""}` : "No element yet. Some say a die decides it…"}<//>
        <${Box} marginTop=${1}><${Text} dimColor>Evolves with your best streak (${best} days) and never loses a form.<//><//>

        <${Box} marginTop=${1} flexWrap="wrap">
          ${STAGES.map((stage, i) => {
            const locked = i > current;
            return html`
              <${Box} key=${stage.name} width=${22} flexDirection="column" marginBottom=${1}>
                <${Box} flexDirection="column"><${Mascot} stage=${i} locked=${locked} face=${locked ? "idle" : "smile"} element=${element} /><//>
                <${Text} bold=${i === current} color=${i === current ? theme.accent : undefined} dimColor=${locked}>${locked ? "???" : stage.name}${i === current ? "  ← now" : ""}<//>
                <${Text} dimColor>${requirement(stage, locked)}<//>
              <//>
            `;
          })}
        <//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>esc back<//><//>
    <//>
  `;
}
