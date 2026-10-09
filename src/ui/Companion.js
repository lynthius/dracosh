import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { STAGES } from "../progress.js";
import { html, PANEL_WIDTH, theme } from "./kit.js";
import { Mascot, MASCOT_WIDTH } from "./Mascot.js";

const MOODS = [
  { face: "idle", label: "calm" },
  { face: "smile", label: "content" },
  { face: "happy", label: "right!" },
  { face: "sad", label: "wrong" },
  { face: "happy", label: "combo", hot: true }
];

const requirement = (stage, locked) => (stage.from === 0 ? "from the start" : `${locked ? "needs " : ""}${stage.from} days`);

// Every form of the companion (dark silhouettes for the ones you haven't reached) and its moods.
export function Companion({ current, best, onClose }) {
  const [shown, setShown] = useState(current);
  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (key.leftArrow) return setShown((s) => Math.max(0, s - 1));
    if (key.rightArrow) return setShown((s) => Math.min(STAGES.length - 1, s + 1));
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} bold color=${theme.accent}>Companion<//>
        <${Text} dimColor>It evolves with your best streak (best: ${best} days) and never loses a form.<//>

        <${Box} marginTop=${1} flexWrap="wrap">
          ${STAGES.map((stage, i) => {
            const locked = i > current;
            return html`
              <${Box} key=${stage.name} width=${22} flexDirection="column" marginBottom=${1}>
                <${Box} flexDirection="column"><${Mascot} stage=${i} locked=${locked} face=${locked ? "idle" : "smile"} /><//>
                <${Text} bold=${i === current} color=${i === current ? theme.accent : undefined} dimColor=${locked}>${stage.name}${i === current ? "  ← now" : ""}<//>
                <${Text} dimColor>${requirement(stage, locked)}<//>
              <//>
            `;
          })}
        <//>

        <${Text} bold>Moods <${Text} dimColor>of ${STAGES[shown].name} · ←/→ to switch form<//><//>
        <${Box} marginTop=${1}>
          ${MOODS.map(
            (mood) => html`
              <${Box} key=${mood.label} width=${MASCOT_WIDTH + 1} flexDirection="column">
                <${Mascot} stage=${shown} face=${mood.face} hot=${Boolean(mood.hot)} locked=${shown > current} />
                <${Text} dimColor>${mood.label}<//>
              <//>
            `
          )}
        <//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>←/→ form · esc back<//><//>
    <//>
  `;
}
