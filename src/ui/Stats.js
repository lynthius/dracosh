import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { dragonName } from "../progress.js";
import { formatRange } from "../vacation.js";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
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
        ${DAY_LETTERS.map((letter, i) =>
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
    [TILE.goal, `goal (${goal})`],
    [TILE.halfway, "halfway"],
    [TILE.some, "some"],
    [TILE.none, "none"],
    [TILE.rest, "rest"],
    [TILE.today, "today"]
  ];
  return html`
    <${Text}>
      ${items.map(([color, label]) => html`<${Text} key=${label}><${Text} color=${color}>■<//><${Text} dimColor> ${label}  <//><//>`)}
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
  const next = companion.nextAt ? ` · next form at a ${companion.nextAt}-day streak` : " · fully evolved";
  const title = dragonName(companion.index, companion.element);

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>Stats<//>

        <${Box} marginTop=${1} flexDirection="column">
          <${Text}>
            ${streak.days > 0 ? html`<${Text} color=${theme.warn} bold>${streak.days}-day streak<//>` : html`<${Text} dimColor>no streak yet<//>`}
            <${Text} dimColor> · best ${streak.best} · ${streak.freezes} freeze${streak.freezes === 1 ? "" : "s"} in stock<//>
          <//>
          <${Text} dimColor>today      ${today.correct}/${goal} correct${accuracy === null ? "" : ` · ${accuracy}% accuracy`}<//>
          <${Text} dimColor>cards      ${stats.mastered} mastered · ${stats.practiced} practiced · ${stats.totalCorrect} correct in total<//>
          <${Text} dimColor>companion  ${title} (${companion.index + 1}/6)${next}<//>
          <${Text} dimColor>rest days  ${stats.skipWeekends ? "weekends" : "no weekends"}${stats.vacation.upcoming.length ? ` · days off ${stats.vacation.upcoming.map((v) => formatRange(v.from, v.to)).join(", ")}` : ""}<//>
        <//>

        <${Box} marginTop=${1} flexDirection="column">
          <${Text} bold>${month.label}<//>
          <${Box} marginTop=${1}><${Calendar} month=${month} goal=${goal} /><//>
          <${Box} marginTop=${1} flexDirection="column">
            <${Text} dimColor>Goal reached on ${month.goalDays} of ${month.daysSoFar} days · ${month.correct} correct answers<//>
            <${Legend} goal=${goal} />
          <//>
        <//>

        <${Box} marginTop=${1}><${Text} dimColor>${unlocked}/${stats.badges.length} badges · /badges lists them all<//><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="←/→ month · esc back" /><//>
    <//>
  `;
}
