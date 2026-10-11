import { t } from "../i18n.js";
import { Fragment } from "react";
import { Box, Text, useInput } from "ink";
import { Bar, html, KeyHints, theme, usePanelWidth } from "./kit.js";
import { dragonName } from "../progress.js";
import { Flame } from "./icons.js";
import { Mascot, MASCOT_WIDTH } from "./Mascot.js";

// The end-of-session screen: how this run went, shown on quit. Any key leaves for real.
export function Summary({ stats, totals, bestCombo, onDone }) {
  const panel = usePanelWidth();
  useInput(() => onDone());
  const { streak, today, goal, companion } = stats;
  const accuracy = totals.asked ? Math.round((totals.correct / totals.asked) * 100) : 0;
  const face = today.goalMet ? "happy" : totals.correct > 0 ? "smile" : "idle";

  return html`
    <${Fragment}>
      <${Box} borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${panel}>
        <${Box} flexDirection="column" width=${MASCOT_WIDTH + 3}>
          <${Mascot} face=${face} stage=${companion.index} element=${companion.element} />
        <//>
        <${Box} flexDirection="column" justifyContent="center">
          <${Box}><${Text} bold color=${theme.accent}>${t("summary.title")}<//><//>
          <${Box}><${Text}>${t("summary.result", { correct: totals.correct, asked: totals.asked, percent: accuracy })}${bestCombo >= 2 ? t("summary.bestCombo", { count: bestCombo }) : ""}<//><//>
          <${Box}>
            <${Text} dimColor>${t("summary.today")}<//>
            <${Bar} value=${today.correct} max=${goal} width=${12} color=${today.goalMet ? theme.good : theme.accent} />
            <${Text} dimColor>  ${Math.min(today.correct, goal)}/${goal}<//>
            ${today.goalMet && html`<${Text} color=${theme.good}>${t("summary.goalReached")}<//>`}
          <//>
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
