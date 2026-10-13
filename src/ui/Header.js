import { useEffect, useState } from "react";
import { t } from "../i18n.js";
import { Box, useStdout } from "ink";
import { formatInterval } from "../settings.js";
import { formatDay } from "../vacation.js";
import { AnimatedBar, cellWidth, cutToWidth, html, Text, theme } from "./kit.js";
import { Flame } from "./icons.js";
import { Mascot, MASCOT_WIDTH } from "./Mascot.js";

const FRAME_MS = 90;
// pixel offsets per animation frame: a hop up for a right answer, a head-shake for a miss
const MOVES = {
  jump: [{ dy: 1 }, { dy: 1 }, { dy: 1 }, {}],
  shake: [{ dx: 1 }, {}, { dx: 1 }, {}]
};

// Replays MOVES[event.kind] once whenever `event` changes, then settles back to stillness.
export function useMove(event) {
  const [frame, setFrame] = useState(-1);
  useEffect(() => {
    if (!event) return undefined;
    const frames = MOVES[event.kind] ?? [];
    setFrame(frames.length ? 0 : -1);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i >= frames.length) {
        clearInterval(id);
        setFrame(-1);
      } else {
        setFrame(i);
      }
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [event]);
  return frame < 0 ? {} : (MOVES[event.kind] ?? [])[frame] ?? {};
}

const BLINK_MS = 140;
const BLINK_GAP_MS = [2500, 7000];
const DOUBLE_BLINK_CHANCE = 0.25;

// Blinks at random moments, now and then twice in a row, like something alive.
export function useBlink() {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let timer;
    const schedule = (ms) => (timer = setTimeout(blink, ms));
    const randomGap = () => BLINK_GAP_MS[0] + Math.random() * (BLINK_GAP_MS[1] - BLINK_GAP_MS[0]);
    function blink(again = Math.random() < DOUBLE_BLINK_CHANCE) {
      setClosed(true);
      timer = setTimeout(() => {
        setClosed(false);
        timer = again ? setTimeout(() => blink(false), BLINK_MS * 1.5) : schedule(randomGap());
      }, BLINK_MS);
    }
    schedule(randomGap());
    return () => clearTimeout(timer);
  }, []);
  return closed;
}

// only calm faces blink: a beaming or crying dragon keeps its expression
const BLINKABLE = new Set(["idle", "smile"]);

const SNORE_ROWS = 5; // as tall as the sprite

// Little z's drifting up beside a sleeping dragon: a lowercase z low down, a capital Z near the top.
export function Snore({ tick }) {
  const step = Math.floor(tick / 2); // half the clock speed: a slow, drowsy drift
  return html`
    <${Box} flexDirection="column" width=${3}>
      ${Array.from({ length: SNORE_ROWS }, (_, r) => {
        const on = (r + step) % 3 === 0 && r < SNORE_ROWS - 1;
        return html`<${Text} key=${r} color=${theme.accent} dimColor=${r > 1}>${on ? (r < 2 ? " Z" : "z ") : "  "}<//>`;
      })}
    <//>
  `;
}

// "Polish · 50 cards · every 10 min", shortened from the end in a narrow pane: the interval goes
// first, then the card count, and only then is the deck's name cut. A study session has no interval.
function deckLine({ deck, wordCount, pace, room }) {
  const cards = wordCount ? t("header.cards", { cards: t("count.cards", { count: wordCount }) }) : "";
  const tries = [pace && t("header.deckLine", { deck, cards, interval: pace }), `  ${deck}${cards}`, `  ${deck}`].filter(Boolean);
  return tries.find((line) => cellWidth(line) <= room) ?? `  ${cutToWidth(deck, Math.max(4, room - 2))}`;
}

// The extras that fit beside what a row always shows, most important first: `[[name, text], …]` → Set of names
function fitting(base, extras, room) {
  let used = base;
  const shown = new Set();
  for (const [name, text] of extras) {
    if (!text) continue;
    if (used + cellWidth(text) > room) break; // a smaller extra never jumps the queue
    used += cellWidth(text);
    shown.add(name);
  }
  return shown;
}

const BAR_WIDTH = 12;
const MIN_BAR_WIDTH = 4;

export function Header({ deck, everyMs, rhythm = "minutes", wordCount, stats, combo, face, event, tick = 0, asleep = false }) {
  const { stdout } = useStdout();
  const rowRoom = (stdout?.columns || 80) - MASCOT_WIDTH - 3 - 2;
  const room = rowRoom - "Dracosh".length;
  const pace = rhythm === "minutes" ? formatInterval(everyMs) : null;
  const { streak, today, goal, companion } = stats;
  const move = useMove(event);
  const blinking = useBlink();
  const hot = combo >= 3 && !asleep;
  // a narrow pane keeps the streak and today's count; the extras beside them go when they don't fit
  const streakText = streak.days > 0 ? t("header.streak", { count: streak.days }) : t("header.noStreak");
  const second = fitting(cellWidth(streakText) + (streak.days > 0 ? 1 : 0), [
    ["atRisk", streak.atRisk && t("header.atRisk")],
    ["daysOff", stats.vacation.activeUntil && t("header.daysOffUntil", { day: formatDay(stats.vacation.activeUntil) })],
    ["freezes", streak.freezes > 0 && t("header.freezes", { count: streak.freezes })]
  ], rowRoom);
  const count = `  ${Math.min(today.correct, goal)}/${goal}`;
  const barWidth = Math.min(BAR_WIDTH, rowRoom - cellWidth(t("header.today")) - cellWidth(count));
  const third = fitting(cellWidth(t("header.today")) + Math.max(0, barWidth) + cellWidth(count), [
    ["combo", combo >= 2 && t("header.combo", { count: combo })],
    ["goal", today.goalMet && t("header.goalReached")]
  ], rowRoom);
  const shown = asleep ? "sleep" : blinking && BLINKABLE.has(face) ? "blink" : face;
  return html`
    <${Box} paddingX=${1}>
      <${Box} width=${MASCOT_WIDTH + 3} flexShrink=${0}>
        <${Box} flexDirection="column" width=${MASCOT_WIDTH}>
          <${Mascot} face=${shown} hot=${hot} flicker=${hot && tick % 2 === 0} stage=${companion.index} element=${companion.element} dx=${move.dx ?? 0} dy=${move.dy ?? 0} />
        <//>
        ${asleep && html`<${Snore} tick=${tick} />`}
      <//>
      <${Box} flexDirection="column" justifyContent="center">
        <${Box}>
          <${Box} flexShrink=${0}><${Text} bold color=${theme.accent}>Dracosh<//><//>
          <${Text} dimColor wrap="truncate-end">${deckLine({ deck, wordCount, pace, room })}<//>
        <//>
        <${Box} height=${1} overflow="hidden">
          ${streak.days > 0
            ? html`<${Box}><${Flame} /><${Text} color=${theme.warn} bold wrap="truncate-end">${streakText}<//><//>`
            : html`<${Text} dimColor wrap="truncate-end">${streakText}<//>`}
          ${second.has("atRisk") && html`<${Text} color=${theme.warn}>${t("header.atRisk")}<//>`}
          ${second.has("daysOff") && html`<${Text} color=${theme.accent}>${t("header.daysOffUntil", { day: formatDay(stats.vacation.activeUntil) })}<//>`}
          ${second.has("freezes") && html`<${Text} dimColor>${t("header.freezes", { count: streak.freezes })}<//>`}
        <//>
        <${Box} height=${1} overflow="hidden">
          <${Text} dimColor>${t("header.today")}<//>
          ${barWidth >= MIN_BAR_WIDTH && html`<${AnimatedBar} value=${today.correct} max=${goal} width=${barWidth} color=${today.goalMet ? theme.good : theme.accent} />`}
          <${Text} dimColor>${count}<//>
          ${third.has("goal") && html`<${Text} color=${theme.good}>${t("header.goalReached")}<//>`}
          ${third.has("combo") && html`<${Text} color=${theme.warn} bold>${t("header.combo", { count: combo })}<//>`}
        <//>
      <//>
    <//>
  `;
}
