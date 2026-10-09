import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { commandsFor } from "../commands.js";
import { diffChars } from "../diff.js";
import { AnswerInput } from "./AnswerInput.js";
import { Header } from "./Header.js";
import { html, Bar, PANEL_WIDTH, theme, Typewriter } from "./kit.js";
import { hintTarget, makeHint } from "../hint.js";
import { formatClock, inQuietHours, parseSnooze, quietEnd } from "../quiet.js";
import { shouldShowTip } from "../tips.js";
import { Badges } from "./Badges.js";
import { Companion } from "./Companion.js";
import { Confetti } from "./Confetti.js";
import { BadgeUnlock } from "./BadgeUnlock.js";
import { DieRoll } from "./DieRoll.js";
import { Evolution } from "./Evolution.js";
import { Hatch } from "./Hatch.js";
import { Missed } from "./Missed.js";
import { Settings } from "./Settings.js";
import { Stats } from "./Stats.js";
import { Summary } from "./Summary.js";
import { TheOne } from "./TheOne.js";
import { Tip } from "./Tip.js";

const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const TICK_MS = 250; // the steady redraw: slow enough to stay idle for hours, fast enough for the spinner
const SLEEP_AFTER_MS = 3 * 60_000; // no key pressed for this long while waiting → the dragon dozes off
const PAUSED_SLEEP_AFTER_MS = 15_000; // during snooze or quiet hours it nods off again much sooner
const CHEER_STYLE = {
  goal: { icon: "▪", color: theme.good },
  evolve: { icon: "▴", color: theme.accent },
  badge: { icon: "✦", color: theme.warn },
  combo: { icon: "»", color: theme.warn }
};

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// your answer with every letter judged: green lined up with the expected word, underlined didn't
function AnswerDiff({ given, closest }) {
  const parts = diffChars(given, closest);
  return html`
    <${Text}>
      <${Text} dimColor>you wrote <//>
      ${parts.map((p, i) => html`<${Text} key=${i} color=${p.ok ? theme.good : theme.text} underline=${!p.ok}>${p.ch}<//>`)}
    <//>
  `;
}

function Verdict({ outcome, question }) {
  if (outcome.result === "skipped") return html`<${Text} dimColor>– skipped<//>`;
  const wrong = outcome.result === "wrong";
  const showDiff = outcome.closest && outcome.given && !outcome.overruled && (wrong || outcome.result === "typo");
  return html`
    <${Box} flexDirection="column">
      <${Text} color=${wrong ? theme.bad : theme.good} bold>${wrong ? "✗" : "✓"} ${question.expected.join(", ")}${outcome.result === "typo" ? "  (close enough)" : ""}<//>
      ${showDiff && html`<${AnswerDiff} given=${outcome.given} closest=${outcome.closest} />`}
      ${question.word.example && html`<${Box} marginTop=${1}><${Text} dimColor italic>“${question.word.example}”<//><//>`}
      ${(outcome.hinted || outcome.overruled) &&
      html`
        <${Box} marginTop=${1} flexDirection="column">
          ${outcome.hinted && html`<${Text} dimColor>hint used · the card stays in its box<//>`}
          ${outcome.overruled && html`<${Text} color=${theme.good}>counted as correct · "${outcome.accepted}" is accepted from now on<//>`}
        <//>
      `}
    <//>
  `;
}

const BADGE_STAGGER_MS = 700; // several badges at once light up one after another

function Cheers({ cheers }) {
  const lines = cheers.filter((cheer) => cheer.kind !== "badge");
  const badges = cheers.filter((cheer) => cheer.kind === "badge");
  return html`
    <${Box} flexDirection="column" paddingX=${1} marginTop=${1}>
      ${lines.map((cheer, i) => {
        const style = CHEER_STYLE[cheer.kind] ?? CHEER_STYLE.combo;
        return html`<${Text} key=${i} color=${style.color} bold>${style.icon} ${cheer.text}<//>`;
      })}
      ${badges.map((badge, i) => html`<${BadgeUnlock} key=${badge.id} ...${badge} delay=${i * BADGE_STAGGER_MS} />`)}
    <//>
  `;
}

// The card's top edge with the direction ("EN → PL") set into its right corner, like a title on the border
function CardTop({ label, width, color }) {
  const tag = ` ${label} `;
  const tail = 2;
  const dashes = Math.max(0, width - 2 - tag.length - tail);
  return html`
    <${Text}>
      <${Text} color=${color}>╭${"─".repeat(dashes)}<//>
      <${Text} dimColor>${tag}<//>
      <${Text} color=${color}>${"─".repeat(tail)}╮<//>
    <//>
  `;
}

function TipBox({ tip, width }) {
  return html`
    <${Box} flexDirection="column" paddingX=${1} marginTop=${2} width=${width}>
      <${Box} marginBottom=${1}><${Text} color=${theme.accent}>tip · ${tip.cat}<//><//>
      <${Typewriter} text=${tip.text} dimColor />
    <//>
  `;
}

export function App({ session, deck, initialSettings, alerts, persistSettings, onExit }) {
  const { exit: exitApp } = useApp();
  const exit = onExit ?? exitApp; // the preview gallery runs the quiz as a scene and takes quitting back to its menu
  const { stdout } = useStdout();
  const [settings, setSettings] = useState(initialSettings);
  // quiz | settings | stats | badges | companion | tip | missed | evolve | the-one | die | summary | hatch
  const [screen, setScreen] = useState(() => (session.isFirstRun() ? "hatch" : "quiz"));
  const [tip, setTip] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | asking | waiting
  const [question, setQuestion] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [problem, setProblem] = useState("");
  const [commandMode, setCommandMode] = useState(false); // typing a "/" command between questions
  const [notice, setNotice] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [nextAt, setNextAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [petEvent, setPetEvent] = useState(null); // { kind: "jump" | "shake", at } → a little hop or head-shake
  const [confetti, setConfetti] = useState(false);
  const [evolution, setEvolution] = useState(null); // { from, to, name } while the ceremony plays
  const [freshBadges, setFreshBadges] = useState([]); // won since /badges was last opened; they light up there
  const [ceremonies, setCeremonies] = useState([]); // full-screen moments still to show: "evolve", "the-one"
  const [lastActive, setLastActive] = useState(Date.now()); // last key press or new question: the dragon sleeps after a long gap
  const busy = useRef(false);
  const asleepRef = useRef(false);
  const bestCombo = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const snoozeRef = useRef(0);
  snoozeRef.current = snoozeUntil;

  // when questions may resume: the end of a snooze or of quiet hours, whichever is later; 0 = not paused
  const pauseEnd = (t) => {
    const quiet = settingsRef.current.quiet;
    return Math.max(snoozeRef.current > t ? snoozeRef.current : 0, inQuietHours(t, quiet) ? quietEnd(t, quiet) : 0);
  };

  const waitForNext = useCallback(() => {
    setNextAt(Date.now() + settingsRef.current.everyMs);
    setPhase("waiting");
    setTip(shouldShowTip(settingsRef.current.tips) ? session.nextTip() : null);
  }, [session]);

  const ask = useCallback(async () => {
    setLastActive(Date.now());
    setPhase("loading");
    setProblem("");
    setNotice("");
    setHintLevel(0);
    setCommandMode(false);
    try {
      const next = await session.next();
      setQuestion(next);
      setOutcome(null);
      setPhase("asking");
    } catch (err) {
      setProblem(err.message);
      waitForNext();
    }
  }, [session, waitForNext]);

  useEffect(() => {
    ask();
  }, [ask]);

  // one steady clock for the whole app: spinner, countdown, mascot blink and combo flicker
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase !== "waiting" || screen === "summary" || screen === "evolve" || screen === "the-one" || screen === "die") return;
    if (now >= nextAt && !pauseEnd(now)) {
      alerts.ask();
      ask();
    }
  }, [now, phase, nextAt, screen, ask, alerts]);

  // quitting goes through the session summary when there is anything to sum up
  const requestExit = useCallback(() => {
    if (session.totals.asked > 0) return setScreen("summary");
    exit();
  }, [session, exit]);

  // any key wakes a sleeping dragon, with a little start
  useInput(() => {
    if (asleepRef.current) setPetEvent({ kind: "jump", at: Date.now() });
    setLastActive(Date.now());
  });

  useInput((input, key) => {
    if (screen !== "quiz" || phase !== "waiting" || commandMode) return;
    if (input === "/") return setCommandMode(true);
    if (key.escape || input === "q") return requestExit();
    if (key.return) ask();
  });

  const clearProblem = useCallback(() => {
    setProblem("");
    setNotice("");
  }, []);

  // every graded answer: sound, a hop or a shake, confetti on the daily goal, the evolution ceremony
  function celebrate(result) {
    alerts.result(result.result, { cheers: result.cheers.map((c) => c.kind), combo: result.combo });
    bestCombo.current = Math.max(bestCombo.current, result.combo);
    setPetEvent({ kind: result.result === "wrong" ? "shake" : "jump", at: Date.now() });
    if (result.cheers.some((c) => c.kind === "goal")) setConfetti(true);
    const queue = [];
    if (result.cheers.some((c) => c.kind === "evolve")) {
      const companion = session.stats().companion;
      setEvolution({ from: Math.max(0, companion.index - 1), to: companion.index, name: companion.name, element: companion.element });
      queue.push("evolve");
    }
    if (result.cheers.some((c) => c.id === "dragons-die")) queue.push("die");
    if (result.cheers.some((c) => c.id === "one-ring")) queue.push("the-one");
    if (queue.length) {
      setCeremonies(queue.slice(1));
      setScreen(queue[0]);
    }
  }

  // after a full-screen ceremony: the next one if both happened at once, otherwise back to the quiz
  function nextCeremony() {
    const [next, ...rest] = ceremonies;
    setCeremonies(rest);
    setScreen(next ?? "quiz");
  }

  function runCommand(name, args = "") {
    setCommandMode(false);
    if (name === "/quit") return requestExit();
    if (name === "/settings") return setScreen("settings");
    if (name === "/stats") return setScreen("stats");
    if (name === "/badges") {
      return session
        .openBadges()
        .then((fresh) => {
          setFreshBadges(fresh);
          setScreen("badges");
        })
        .catch((err) => setProblem(err.message));
    }
    if (name === "/companion") return setScreen("companion");
    if (name === "/tip") return setScreen("tip");
    if (name === "/missed") return setScreen("missed");
    if (name === "/hint" && phase === "asking") return setHintLevel((level) => level + 1);
    if (name === "/vacation") {
      return session
        .vacation(args)
        .then(setNotice)
        .catch((err) => setProblem(err.message));
    }
    if (name === "/snooze") {
      const length = parseSnooze(args);
      if (length === null) return setProblem("Try /snooze 30m, /snooze 2h or /snooze off");
      if (length === "off") {
        setSnoozeUntil(0);
        return setNotice("Snooze off: questions are back");
      }
      setSnoozeUntil(Date.now() + length);
      return phase === "asking" ? setNotice(`Questions paused until ${formatClock(Date.now() + length)}`) : undefined; // while waiting, the status line says it
    }
    if (name === "/skip") {
      setOutcome({ result: "skipped", cheers: [] });
      return waitForNext();
    }
    if (name === "/correct" && session.canOverrule()) {
      return session
        .overrule()
        .then((result) => {
          setOutcome(result);
          celebrate(result);
        })
        .catch((err) => setProblem(`Couldn't save progress: ${err.message}`));
    }
    setProblem(`Unknown command ${name}`);
  }

  function changeSettings(patch) {
    const previous = settingsRef.current;
    const next = { ...previous, ...patch };
    settingsRef.current = next;
    setSettings(next);
    alerts.configure({ sound: next.sound, volume: next.volume });
    persistSettings(patch).catch(() => {});
    if (patch.everyMs && phase === "waiting") setNextAt((at) => at - previous.everyMs + patch.everyMs);
    if (patch.volume !== undefined || patch.sound === true) alerts.play("correct-0"); // audible preview
  }

  async function submit(raw) {
    const text = raw.trim();
    if (!text || busy.current) return;
    busy.current = true;
    try {
      const result = await session.answer(question, text, { hinted: hintLevel > 0 });
      setOutcome(result);
      celebrate(result);
    } catch (err) {
      setProblem(`Couldn't save progress: ${err.message}`);
    } finally {
      busy.current = false;
      waitForNext();
    }
  }

  const width = Math.min((stdout?.columns ?? PANEL_WIDTH + 2) - 2, PANEL_WIDTH);
  const border = !outcome ? theme.accent : outcome.result === "wrong" ? theme.bad : outcome.result === "skipped" ? "gray" : theme.good;
  const pausedUntil = pauseEnd(now);
  const tick = Math.floor(now / TICK_MS);
  const frame = SPINNER[tick % SPINNER.length];
  const stats = session.stats();
  // mood: how the last answer went, otherwise whether today's goal is done (Header adds the blinking)
  const resting = stats.today.goalMet ? "smile" : "idle";
  const face = outcome?.result === "wrong" ? "sad" : outcome && outcome.result !== "skipped" ? "happy" : resting;
  // strictly boolean: a bare 0 leaking into the markup crashes Ink ("Text string must be rendered inside <Text>")
  const paused = pausedUntil > nextAt || (now >= nextAt && pausedUntil > 0);
  // asleep: no key pressed for a while, whether a question is open or not; a key always wakes it,
  // even during snooze or quiet hours (where it nods off again sooner)
  const idleLimit = phase === "waiting" && pausedUntil > 0 ? PAUSED_SLEEP_AFTER_MS : SLEEP_AFTER_MS;
  const asleep = phase !== "loading" && now - lastActive > idleLimit;
  asleepRef.current = asleep;

  if (screen === "hatch")
    return html`<${Box} flexDirection="column" marginY=${1}><${Hatch} play=${alerts.play} onDone=${() => {
      session.markHatched().catch(() => {});
      setScreen("quiz");
    }} /><//>`;
  if (screen === "summary") return html`<${Box} flexDirection="column" marginY=${1}><${Summary} stats=${stats} totals=${session.totals} bestCombo=${bestCombo.current} onDone=${exit} /><//>`;
  if (screen === "evolve" && evolution)
    return html`<${Box} flexDirection="column" marginY=${1}><${Evolution} ...${evolution} onClose=${() => {
      setEvolution(null);
      nextCeremony();
    }} /><//>`;
  if (screen === "die")
    return html`<${Box} flexDirection="column" marginY=${1}><${DieRoll} element=${stats.companion.element} stage=${stats.companion.index} play=${alerts.play} onClose=${nextCeremony} /><//>`;
  if (screen === "the-one") return html`<${Box} flexDirection="column" marginY=${1}><${TheOne} play=${alerts.play} onClose=${nextCeremony} /><//>`;
  if (screen === "stats") return html`<${Box} flexDirection="column" marginY=${1}><${Stats} stats=${stats} getMonth=${session.month} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "companion") return html`<${Box} flexDirection="column" marginY=${1}><${Companion} current=${stats.companion.index} best=${stats.streak.best} element=${stats.companion.element} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "tip") return html`<${Box} flexDirection="column" marginY=${1}><${Tip} nextTip=${session.nextTip} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "missed") return html`<${Box} flexDirection="column" marginY=${1}><${Missed} getMissed=${session.missed} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "badges") return html`<${Box} flexDirection="column" marginY=${1}><${Badges} badges=${stats.badges} fresh=${freshBadges} onClose=${() => setScreen("quiz")} /><//>`;

  return html`
    <${Box} flexDirection="column" marginY=${1}>
      <${Header} deck=${deck} everyMs=${settings.everyMs} wordCount=${question?.wordCount} stats=${stats} combo=${session.totals.combo} face=${face} event=${petEvent} tick=${tick} asleep=${asleep} />
      <${Box} marginTop=${1} flexDirection="column">
        ${screen === "settings"
          ? html`<${Settings} settings=${settings} onChange=${changeSettings} onClose=${() => setScreen("quiz")} />`
          : html`
              <${Fragment}>
              ${question &&
              html`
                <${Box} flexDirection="column" width=${width}>
                  <${CardTop} label=${question.label} width=${width} color=${border} />
                  <${Box} flexDirection="column" borderStyle="round" borderTop=${false} borderColor=${border} paddingX=${2} paddingTop=${1}>
                    <${Text} bold>${question.prompt}<//>
                    ${phase === "asking" && hintLevel > 0 && html`<${Text} dimColor>hint   ${makeHint(hintTarget(question.expected), hintLevel)}<//>`}
                    <${Box} marginTop=${1} flexDirection="column">
                      ${phase === "asking" && html`<${AnswerInput} key=${question.word.noteId + question.direction} onSubmit=${submit} onCommand=${runCommand} onExit=${requestExit} onEdit=${clearProblem} commands=${commandsFor({ phase: "asking" })} />`}
                      ${phase !== "asking" && outcome && html`<${Verdict} outcome=${outcome} question=${question} />`}
                    <//>
                  <//>
                <//>
              `}
              ${confetti && html`<${Confetti} width=${width} onDone=${() => setConfetti(false)} />`}
              ${outcome?.cheers?.length > 0 && html`<${Cheers} cheers=${outcome.cheers} />`}
              ${phase === "waiting" && tip && html`<${TipBox} tip=${tip} width=${width} />`}
              <${Box} paddingX=${1} marginTop=${1} flexDirection="column">
                ${question?.cached && html`<${Text} color=${theme.warn}>Anki is offline, using the saved word list<//>`}
                ${problem && html`<${Text} color=${theme.bad}>${problem}<//>`}
                ${phase === "loading" && html`<${Text}><${Text} color=${theme.accent}>${frame}<//><${Text} dimColor> loading…<//><//>`}
                ${notice && html`<${Text} color=${theme.accent}>${notice}<//>`}
                ${phase === "waiting" && paused && html`<${Text} dimColor>paused until ${formatClock(pausedUntil)}${inQuietHours(now, settings.quiet) ? " (quiet hours)" : ""}<//>`}
                ${phase === "waiting" &&
                !paused &&
                html`
                  <${Text}>
                    <${Text} color=${theme.accent}>${frame} <//>
                    <${Bar} value=${Math.max(0, nextAt - now)} max=${settings.everyMs} width=${14} color="#6b5e8a" />
                    <${Text} dimColor>  next word in ${clock(nextAt - now)}<//>
                  <//>
                `}
                ${phase === "waiting" && commandMode && html`<${AnswerInput} commandOnly initial="/" commands=${commandsFor({ phase: "waiting", canOverrule: session.canOverrule() })} onCommand=${runCommand} onCancel=${() => setCommandMode(false)} onEdit=${clearProblem} />`}
                ${phase !== "loading" && !commandMode && html`<${Text} dimColor>${phase === "asking" ? "enter submit · / commands · esc quit" : `${session.canOverrule() ? "/correct if you were right · " : ""}enter ask now · / commands · q quit`}<//>`}
              <//>
              <//>
            `}
      <//>
    <//>
  `;
}
