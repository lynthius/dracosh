import { t } from "../i18n.js";
import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { dragonName } from "../progress.js";
import { formatRange } from "../vacation.js";
import { html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

// One shape for every day; only the color tells them apart, GitHub-contribution style.
const TILE = {
  goal: theme.good,
  halfway: "#3f9d5e",
  some: "#2f6b45",
  none: "#3a3f47",
  rest: "#2a2e35",
  future: "#1c1f25",
  today: theme.accent // today with nothing done yet
};

function tileColor(cell, goal) {
  if (cell.goalMet) return TILE.goal;
  if (cell.correct > 0) return cell.correct >= goal / 2 ? TILE.halfway : TILE.some;
  if (cell.today) return TILE.today;
  if (cell.future) return TILE.future;
  return cell.rest ? TILE.rest : TILE.none;
}

// A plain full-month grid: weeks as rows under one-letter day headers.
// Today: its weekday letter lights up, and its tile is violet until the first correct answer.
function Calendar({ month, goal }) {
  const todayColumn = month.weeks.flat().findIndex((cell) => cell?.today) % 7;
  return html`
    <${Box} flexDirection="column">
      <${Box}>
        ${t("stats.weekdays").split(" ").map((letter, i) =>
          i === todayColumn ? html`<${Text} key=${i} color=${theme.accent} bold>${letter} <//>` : html`<${Text} key=${i} dimColor>${letter} <//>`
        )}
      <//>
      ${month.weeks.map(
        (week, w) => html`
          <${Box} key=${w}>
            ${week.map((cell, d) => (cell ? html`<${Text} key=${d}><${Text} color=${tileColor(cell, goal)}>■<//> <//>` : html`<${Text} key=${d}>  <//>`))}
          <//>
        `
      )}
    <//>
  `;
}

function Legend({ goal }) {
  const items = [
    [TILE.goal, t("stats.legend.goal", { goal })],
    [TILE.halfway, t("stats.legend.halfway")],
    [TILE.some, t("stats.legend.some")],
    [TILE.none, t("stats.legend.none")],
    [TILE.rest, t("stats.legend.rest")],
    [TILE.today, t("stats.legend.today")]
  ];
  // a box per item, so a longer language wraps whole items instead of splitting one
  return html`
    <${Box} flexWrap="wrap" columnGap=${2}>
      ${items.map(([color, label]) => html`<${Text} key=${label}><${Text} color=${color}>■<//><${Text} dimColor> ${label}<//><//>`)}
    <//>
  `;
}

export function Stats({ stats, getMonth, onClose }) {
  const panel = usePanelWidth();
  const [offset, setOffset] = useState(0);
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") return onClose();
    if (key.leftArrow) return setOffset((o) => o - 1);
    if (key.rightArrow) return setOffset((o) => Math.min(0, o + 1));
  });

  const { streak, today, goal, companion } = stats;
  const accuracy = today.asked ? Math.round((today.correct / today.asked) * 100) : null;
  const unlocked = stats.badges.filter((b) => b.unlockedOn).length;
  const month = getMonth(offset);
  const next = companion.nextAt ? t("stats.nextForm", { count: companion.nextAt }) : t("stats.fullyEvolved");
  const title = dragonName(companion.index, companion.element);

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("stats.title")}<//>

        <${Box} marginTop=${1} flexDirection="column">
          <${Text}>
            ${streak.days > 0 ? html`<${Text} color=${theme.warn} bold>${t("stats.streak", { count: streak.days })}<//>` : html`<${Text} dimColor>${t("stats.noStreak")}<//>`}
            <${Text} dimColor>${t("stats.bestAndFreezes", { best: streak.best, count: streak.freezes })}<//>
          <//>
          <${Text} dimColor>${t("stats.today", { correct: today.correct, goal, accuracy: accuracy === null ? "" : t("stats.accuracy", { percent: accuracy }) })}<//>
          <${Text} dimColor>${t("stats.cards", { mastered: stats.mastered, practised: stats.practiced, total: stats.totalCorrect })}<//>
          <${Text} dimColor>${t("stats.companion", { name: title, stage: companion.index + 1, next })}<//>
          <${Text} dimColor>${t("stats.restDays", { weekends: t(stats.skipWeekends ? "stats.weekends" : "stats.noWeekends"), daysOff: stats.vacation.upcoming.length ? t("stats.daysOff", { ranges: stats.vacation.upcoming.map((v) => formatRange(v.from, v.to)).join(", ") }) : "" })}<//>
        <//>

        <${Box} marginTop=${1} flexDirection="column">
          <${Text} bold>${month.label}<//>
          <${Box} marginTop=${1}><${Calendar} month=${month} goal=${goal} /><//>
          <${Box} marginTop=${1} flexDirection="column">
            <${Text} dimColor>${t("stats.month", { goalDays: month.goalDays, days: month.daysSoFar, correct: month.correct })}<//>
            <${Legend} goal=${goal} />
          <//>
        <//>

        <${Box} marginTop=${1}><${Text} dimColor>${t("stats.badgesLine", { unlocked, total: stats.badges.length })}<//><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.stats")} /><//>
    <//>
  `;
}
