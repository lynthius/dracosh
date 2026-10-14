import { t } from "../i18n.js";
import { Fragment } from "react";
import { Box, useInput } from "ink";
import { Bar, cellWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";
import { dragonName } from "../progress.js";
import { Flame } from "./icons.js";
import { Mascot, MASCOT_WIDTH } from "./Mascot.js";

const BAR = 12;
const MIN_BAR = 4;

// The end-of-session screen: how this run went, shown on quit. Any key leaves for real.
export function Summary({ stats, totals, bestCombo, onDone }) {
  const panel = usePanelWidth();
  const { streak, today, goal, companion } = stats;
  // the "today" row fits beside the dragon: the bar shrinks first, then "goal reached" goes
  const room = panel - 6 - (MASCOT_WIDTH + 3);
  const count = `  ${Math.min(today.correct, goal)}/${goal}`;
  const reached = today.goalMet ? cellWidth(t("summary.goalReached")) : 0;
  const fitBar = (extra) => Math.min(BAR, room - cellWidth(t("summary.today")) - cellWidth(count) - extra);
  const showReached = reached > 0 && fitBar(reached) >= MIN_BAR;
  const barWidth = fitBar(showReached ? reached : 0);
  useInput(() => onDone());
  const accuracy = totals.asked ? Math.round((totals.correct / totals.asked) * 100) : 0;
  const face = today.goalMet ? "happy" : totals.correct > 0 ? "smile" : "idle";

  return html`
    <${Fragment}>
      <${Box} borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${panel}>
        <${Box} flexDirection="column" width=${MASCOT_WIDTH + 3} flexShrink=${0}>
          <${Mascot} face=${face} stage=${companion.index} element=${companion.element} />
        <//>
        <${Box} flexDirection="column" justifyContent="center">
          <${Box}><${Text} bold color=${theme.accent}>${t("summary.title")}<//><//>
          <${Box}><${Text}>${t("summary.result", { correct: totals.correct, asked: totals.asked, percent: accuracy })}${bestCombo >= 2 ? t("summary.bestCombo", { count: bestCombo }) : ""}<//><//>
          ${barWidth >= MIN_BAR
            ? html`
                <${Box}>
                  <${Text} dimColor>${t("summary.today")}<//>
                  <${Bar} value=${today.correct} max=${goal} width=${barWidth} color=${today.goalMet ? theme.good : theme.accent} />
                  <${Text} dimColor>${count}<//>
                  ${today.goalMet && showReached && html`<${Text} color=${theme.good}>${t("summary.goalReached")}<//>`}
                <//>
              `
            : html`<${Text} dimColor>${t("summary.today").trim()} ${count.trim()}<//>`}
          <${Box}>
            ${streak.days > 0 && html`<${Box}><${Flame} /><${Text}> <//><//>`}
            <${Text} dimColor>${streak.days > 0 ? t("summary.streak", { count: streak.days }) : t("summary.noStreak")}${streak.atRisk ? t("summary.atRisk") : ""}<//>
          <//>
          <${Box}><${Text} dimColor>${t("summary.waiting", { name: dragonName(companion.index, companion.element) })}<//><//>
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("summary.keys")} /><//>
    <//>
  `;
}
