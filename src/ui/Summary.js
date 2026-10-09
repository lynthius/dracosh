import { Fragment } from "react";
import { Box, Text, useInput } from "ink";
import { Bar, html, PANEL_WIDTH, theme } from "./kit.js";
import { Flame } from "./icons.js";
import { Mascot, MASCOT_WIDTH } from "./Mascot.js";

// The end-of-session screen: how this run went, shown on quit. Any key leaves for real.
export function Summary({ stats, totals, bestCombo, onDone }) {
  useInput(() => onDone());
  const { streak, today, goal, companion } = stats;
  const accuracy = totals.asked ? Math.round((totals.correct / totals.asked) * 100) : 0;
  const face = today.goalMet ? "happy" : totals.correct > 0 ? "smile" : "idle";

  return html`
    <${Fragment}>
      <${Box} borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${PANEL_WIDTH}>
        <${Box} flexDirection="column" width=${MASCOT_WIDTH + 3}>
          <${Mascot} face=${face} stage=${companion.index} />
        <//>
        <${Box} flexDirection="column" justifyContent="center">
          <${Box}><${Text} bold color=${theme.accent}>Session over<//><//>
          <${Box}><${Text}>${totals.correct}/${totals.asked} correct · ${accuracy}%${bestCombo >= 2 ? ` · best combo ×${bestCombo}` : ""}<//><//>
          <${Box}>
            <${Text} dimColor>today  <//>
            <${Bar} value=${today.correct} max=${goal} width=${12} color=${today.goalMet ? theme.good : theme.accent} />
            <${Text} dimColor>  ${Math.min(today.correct, goal)}/${goal}<//>
            ${today.goalMet && html`<${Text} color=${theme.good}>  goal reached<//>`}
          <//>
          <${Box}>
            ${streak.days > 0 && html`<${Box}><${Flame} /><${Text}> <//><//>`}
            <${Text} dimColor>${streak.days > 0 ? `${streak.days}-day streak` : "no streak yet"}${streak.atRisk ? " · still at risk today" : ""}<//>
          <//>
        <//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>see you later · any key to leave<//><//>
    <//>
  `;
}
