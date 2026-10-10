import { Fragment, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { DEMO_WORDS } from "../demo.js";
import { addDays, dayKey } from "../dates.js";
import { BADGES, ELEMENTS, ensureProgress, rollElement, STAGES } from "../progress.js";
import { createSession } from "../session.js";
import { DEFAULTS } from "../settings.js";
import { DieRoll } from "./DieRoll.js";
import { App } from "./App.js";
import { BadgeUnlock } from "./BadgeUnlock.js";
import { Badges } from "./Badges.js";
import { Confetti } from "./Confetti.js";
import { Evolution } from "./Evolution.js";
import { Hatch } from "./Hatch.js";
import { Header, Snore, useBlink, useMove } from "./Header.js";
import { html, KeyHints, PANEL_WIDTH, theme } from "./kit.js";
import { Mascot } from "./Mascot.js";
import { Stats } from "./Stats.js";
import { Summary } from "./Summary.js";
import { TheOne } from "./TheOne.js";

// Everything here runs on made-up data in memory: nothing is read from or written to ~/.dracosh.

const FACES = ["idle", "smile", "happy", "sad", "blink", "sleep"];

// a throwaway session; `progress` fills in a believable last few weeks
function fakeSession({ settings = {}, progress = false } = {}) {
  const state = { items: {}, newToday: { date: "", count: 0 }, hatched: true };
  const all = { ...DEFAULTS, dailyGoal: 5, everyMs: 6000, tips: "always", ...settings };
  if (progress) {
    const p = ensureProgress(state);
    const today = dayKey(Date.now());
    const counts = [9, 20, 0, 12, 25, 20, 3, 0, 20, 22, 8, 20, 0, 20, 14, 20, 20, 5];
    counts.forEach((correct, i) => {
      if (correct) p.days[addDays(today, -(i + 1))] = { asked: correct + 2, correct, goalMet: correct >= 20 };
    });
    p.days[today] = { asked: 7, correct: 6 };
    p.streak = { ...p.streak, count: 12, best: 34, lastGoalDay: addDays(today, -2) };
    BADGES.slice(0, 13).forEach((b, i) => (p.badges[b.id] = addDays(today, -i * 3)));
  }
  return createSession({ loadWords: async () => ({ words: DEMO_WORDS }), state, getSettings: () => all, save: async () => {} });
}

// a 250 ms tick for the lab's own little animations (the snoring z's)
function useClock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  return tick;
}

// The mascot on its own, to poke at: every form, face, move and the combo glow.
function MascotLab({ onBack }) {
  const [stage, setStage] = useState(0);
  const [face, setFace] = useState(0);
  const [hot, setHot] = useState(false);
  const [element, setElement] = useState(-1); // -1: the default green dragon
  const [event, setEvent] = useState(null);
  const [tick, setTick] = useState(0);
  const move = useMove(event);
  const blinking = useBlink();
  const clock = useClock();
  useInput((input, key) => {
    if (key.escape || input === "q") return onBack();
    if (key.leftArrow) return setStage((s) => Math.max(0, s - 1));
    if (key.rightArrow) return setStage((s) => Math.min(STAGES.length - 1, s + 1));
    if (key.upArrow || key.downArrow) return setFace((f) => (f + (key.upArrow ? FACES.length - 1 : 1)) % FACES.length);
    if (input === "j") return setEvent({ kind: "jump", at: Date.now() });
    if (input === "s") return setEvent({ kind: "shake", at: Date.now() });
    if (input === "h") return setHot((h) => !h);
    if (input === "e") return setElement((e) => (e + 2) % (ELEMENTS.length + 1) - 1);
    if (input === " ") return setTick((t) => t + 1); // hand-cranked flicker frame
  });
  const shownFace = blinking && FACES[face] === "idle" ? "blink" : FACES[face];
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${PANEL_WIDTH} alignItems="center">
        <${Text} bold color=${theme.accent}>Mascot lab<//>
        <${Box} marginY=${1} flexDirection="column" alignItems="center">
          <${Mascot} stage=${stage} face=${shownFace} hot=${hot} flicker=${hot && tick % 2 === 0} scale=${2} dx=${move.dx ?? 0} dy=${move.dy ?? 0} element=${ELEMENTS[element] ?? null} />
        <//>
        ${FACES[face] === "sleep" && html`<${Box}><${Mascot} stage=${stage} face="sleep" /><${Snore} tick=${clock} /><//>`}
        <${Text}>${STAGES[stage].name}<${Text} dimColor> · face ${FACES[face]} · ${ELEMENTS[element] ?? "no element"}${hot ? " · combo glow" : ""}<//><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="←/→ form · ↑/↓ face · e element · j jump · s shake · h glow · esc back" /><//>
    <//>
  `;
}

// three badges won with one answer, lighting up one after another, as under the quiz card
const UNLOCK_SAMPLE = ["thousand", "hot-streak", "dragons-hoard"];

function BadgeUnlockLab({ onBack }) {
  const [run, setRun] = useState(1);
  useInput((input, key) => {
    if (key.escape || input === "q") return onBack();
    if (key.return || input === " ") setRun((r) => r + 1);
  });
  const badges = UNLOCK_SAMPLE.map((id) => BADGES.find((badge) => badge.id === id));
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.good} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} color=${theme.good} bold>✓ dragon<//>
        ${badges.map((badge, i) => html`<${BadgeUnlock} key=${`${run}-${badge.id}`} id=${badge.id} name=${badge.name} desc=${badge.desc} delay=${i * 700} />`)}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="enter replay · esc back" /><//>
    <//>
  `;
}

// The quiz screen's header with any form and element, to check how the dragon looks and fits there
function QuizLookLab({ onBack }) {
  const [stage, setStage] = useState(STAGES.length - 1);
  const [element, setElement] = useState(-1);
  const [combo, setCombo] = useState(0);
  useInput((input, key) => {
    if (key.escape || input === "q") return onBack();
    if (key.leftArrow) return setStage((s) => Math.max(0, s - 1));
    if (key.rightArrow) return setStage((s) => Math.min(STAGES.length - 1, s + 1));
    if (input === "e") return setElement((e) => (e + 2) % (ELEMENTS.length + 1) - 1);
    if (input === "c") return setCombo((c) => (c ? 0 : 7));
  });
  const stats = {
    streak: { days: 42, best: 120, freezes: 1, atRisk: false },
    today: { correct: 13, asked: 15, goalMet: false },
    goal: 20,
    vacation: { activeUntil: null },
    companion: { index: stage, name: STAGES[stage].name, element: ELEMENTS[element] ?? null }
  };
  return html`
    <${Fragment}>
      <${Header} deck="Polish" everyMs=${600000} wordCount=${340} stats=${stats} combo=${combo} face="idle" event=${null} tick=${0} />
      <${Box} marginTop=${1} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} paddingY=${1} width=${PANEL_WIDTH}>
        <${Text} bold>la mariposa<//>
        <${Box} marginTop=${1}><${Text} color=${theme.accent}>❯ <//><${Text} inverse> <//><//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>${STAGES[stage].name} · ${ELEMENTS[element] ?? "no element"} · ←/→ form · e element · c combo · esc back<//><//>
    <//>
  `;
}

function ConfettiLab({ onBack }) {
  const [run, setRun] = useState(1);
  useInput((input, key) => {
    if (key.escape || input === "q") return onBack();
    if (key.return || input === " ") setRun((r) => r + 1);
  });
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.good} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} color=${theme.good} bold>▪ Daily goal reached · 12-day streak<//>
      <//>
      <${Box} height=${5}><${Confetti} key=${run} width=${PANEL_WIDTH} onDone=${() => {}} /><//>
      <${Box} paddingX=${1}><${KeyHints} text="enter replay · esc back" /><//>
    <//>
  `;
}

const SCENES = [
  { id: "hatch", label: "Hatching", hint: "the first-launch intro" },
  ...STAGES.slice(1).map((stage, i) => ({ id: `evolve-${i + 1}`, label: `Evolution → ${stage.name}`, hint: `reached at a ${stage.from}-day best streak` })),
  { id: "mascot", label: "Mascot lab", hint: "forms, faces, elements, moves, glow" },
  { id: "quiz", label: "Quiz", hint: "a live round on demo words, goal at 5" },
  { id: "quiz-look", label: "Quiz screen", hint: "the header with any form and element" },
  { id: "unlock", label: "Badge unlocked", hint: "three badges won at once" },
  { id: "the-one", label: "The One...", hint: "the ring rises from the lava" },
  { id: "die", label: "Dragon's die", hint: "the secret badge: a roll for an element" },
  { id: "confetti", label: "Confetti", hint: "the daily-goal burst" },
  { id: "stats", label: "Stats", hint: "calendar tiles, weeks of fake history" },
  { id: "badges", label: "Badges", hint: "all unlocked, three of them new" },
  { id: "summary", label: "Session summary", hint: "what you see when quitting" }
];

function Menu({ selected, onMove, onPick, onQuit }) {
  useInput((input, key) => {
    if (key.escape || input === "q") return onQuit();
    if (key.upArrow) return onMove(-1);
    if (key.downArrow) return onMove(1);
    if (key.return) onPick();
  });
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Box}><${Text} bold color=${theme.accent}>Preview<//><${Text} dimColor>  made-up data · nothing is saved<//><//>
        <${Box} flexDirection="column" marginTop=${1}>
          ${SCENES.map(
            (scene, i) => html`
              <${Box} key=${scene.id}>
                <${Box} width=${25} flexShrink=${0}>
                  <${Text} color=${i === selected ? theme.accent : undefined} bold=${i === selected}>${i === selected ? "❯" : " "} ${scene.label}<//>
                <//>
                <${Text} dimColor wrap="truncate-end">${scene.hint}<//>
              <//>
            `
          )}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="↑/↓ choose · enter play · esc quit" /><//>
    <//>
  `;
}

// `dracosh --preview`: a gallery of every scene and animation, to look at without playing for weeks.
export function Preview({ alerts }) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const [scene, setScene] = useState(null);
  const [run, setRun] = useState(0); // a fresh key per play, so every scene starts from its first frame
  const back = () => setScene(null);
  const history = useMemo(() => fakeSession({ progress: true }), []);
  const quizSession = useMemo(() => fakeSession(), [run]); // every quiz run starts from zero
  const dieElement = useMemo(() => rollElement(), [run]); // a fresh roll every time the scene plays

  const wrap = (content) => html`<${Box} flexDirection="column" marginY=${1}>${content}<//>`;

  function pick() {
    const id = SCENES[selected].id;
    if (id.startsWith("evolve-")) alerts.play("evolve"); // in the app the answer that triggers it plays this
    setRun((r) => r + 1);
    setScene(id);
  }

  if (!scene) {
    return wrap(html`<${Menu} selected=${selected} onMove=${(d) => setSelected((s) => (s + d + SCENES.length) % SCENES.length)} onPick=${pick} onQuit=${exit} />`);
  }
  if (scene === "hatch") return wrap(html`<${Hatch} key=${run} play=${alerts.play} onDone=${back} />`);
  if (scene.startsWith("evolve-")) {
    const to = Number(scene.slice("evolve-".length));
    return wrap(html`<${Evolution} key=${run} from=${to - 1} to=${to} name=${STAGES[to].name} onClose=${back} />`);
  }
  if (scene === "mascot") return wrap(html`<${MascotLab} onBack=${back} />`);
  if (scene === "quiz-look") return wrap(html`<${QuizLookLab} onBack=${back} />`);
  if (scene === "confetti") return wrap(html`<${ConfettiLab} onBack=${back} />`);
  if (scene === "unlock") return wrap(html`<${BadgeUnlockLab} onBack=${back} />`);
  if (scene === "die") return wrap(html`<${DieRoll} key=${run} element=${dieElement} stage=${2} play=${alerts.play} onClose=${back} />`);
  if (scene === "the-one") return wrap(html`<${TheOne} key=${run} play=${alerts.play} onClose=${back} />`);
  if (scene === "stats") return wrap(html`<${Stats} stats=${history.stats()} getMonth=${history.month} onClose=${back} />`);
  if (scene === "badges") {
    // every badge unlocked, so each icon and rank color can be seen
    const all = history.stats().badges.map((badge) => ({ ...badge, unlockedOn: badge.unlockedOn ?? dayKey(Date.now()) }));
    return wrap(html`<${Badges} key=${run} badges=${all} fresh=${["thousand", "hot-streak", "dragonheart"]} onClose=${back} />`);
  }
  if (scene === "summary")
    return wrap(html`<${Summary} stats=${history.stats()} totals=${{ asked: 23, correct: 20 }} bestCombo=${9} onDone=${back} />`);
  if (scene === "quiz") {
    return html`<${App} key=${run} session=${quizSession} deck="Demo" initialSettings=${{ ...DEFAULTS, dailyGoal: 5, everyMs: 6000, tips: "always" }} alerts=${alerts} persistSettings=${async () => {}} onExit=${back} />`;
  }
  return null;
}
