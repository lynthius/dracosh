import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { formatInterval } from "../settings.js";
import { formatDay } from "../vacation.js";
import { AnimatedBar, html, theme } from "./kit.js";
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

export function Header({ deck, everyMs, wordCount, stats, combo, face, event, tick = 0, asleep = false }) {
  const { streak, today, goal, companion } = stats;
  const move = useMove(event);
  const blinking = useBlink();
  const hot = combo >= 3 && !asleep;
  const shown = asleep ? "sleep" : blinking && BLINKABLE.has(face) ? "blink" : face;
  return html`
    <${Box} paddingX=${1}>
      <${Box} width=${MASCOT_WIDTH + 3}>
        <${Box} flexDirection="column" width=${MASCOT_WIDTH}>
          <${Mascot} face=${shown} hot=${hot} flicker=${hot && tick % 2 === 0} stage=${companion.index} element=${companion.element} dx=${move.dx ?? 0} dy=${move.dy ?? 0} />
        <//>
        ${asleep && html`<${Snore} tick=${tick} />`}
      <//>
      <${Box} flexDirection="column" justifyContent="center">
        <${Box}>
          <${Text} bold color=${theme.accent}>Dracosh<//>
          <${Text} dimColor>  ${deck}${wordCount ? ` · ${wordCount} card${wordCount === 1 ? "" : "s"}` : ""} · every ${formatInterval(everyMs)}<//>
        <//>
        <${Box}>
          ${streak.days > 0
            ? html`<${Box}><${Flame} /><${Text} color=${theme.warn} bold> ${streak.days}-day streak<//><//>`
            : html`<${Text} dimColor>no streak yet<//>`}
          ${streak.atRisk && html`<${Text} color=${theme.warn}> · at risk today<//>`}
          ${stats.vacation.activeUntil && html`<${Text} color=${theme.accent}> · days off until ${formatDay(stats.vacation.activeUntil)}<//>`}
          ${streak.freezes > 0 && html`<${Text} dimColor> · ${streak.freezes} freeze${streak.freezes > 1 ? "s" : ""}<//>`}
        <//>
        <${Box}>
          <${Text} dimColor>today  <//>
          <${AnimatedBar} value=${today.correct} max=${goal} width=${12} color=${today.goalMet ? theme.good : theme.accent} />
          <${Text} dimColor>  ${Math.min(today.correct, goal)}/${goal}<//>
          ${today.goalMet && html`<${Text} color=${theme.good}>  goal reached<//>`}
          ${combo >= 2 && html`<${Text} color=${theme.warn} bold>  combo ×${combo}<//>`}
        <//>
      <//>
    <//>
  `;
}
