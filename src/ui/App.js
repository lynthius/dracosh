import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import { commandsFor } from "../commands.js";
import { diffChars } from "../diff.js";
import { AnswerInput } from "./AnswerInput.js";
import { Header } from "./Header.js";
import { setLanguage, t } from "../i18n.js";
import { Bar, cellWidth, cutToWidth, html, KeyHints, Marked, Text, theme, Typewriter, usePanelWidth } from "./kit.js";
import { hintTarget, makeHint } from "../hint.js";
import { formatClock, inQuietHours, quietEnd } from "../quiet.js";
import { startOfTomorrow } from "../scheduler.js";
import { formatDay } from "../vacation.js";
import { dayKey } from "../dates.js";
import { shouldShowTip } from "../tips.js";
import { sessionLength } from "../settings.js";
import { Badges } from "./Badges.js";
import { Companion } from "./Companion.js";
import { Confetti } from "./Confetti.js";
import { BadgeUnlock, badgeSound } from "./BadgeUnlock.js";
import { DieRoll } from "./DieRoll.js";
import { Evolution } from "./Evolution.js";
import { Hatch } from "./Hatch.js";
import { AddCard } from "./AddCard.js";
import { Decks } from "./Decks.js";
import { Reset } from "./Reset.js";
import { Help } from "./Help.js";
import { Missed } from "./Missed.js";
import { Settings } from "./Settings.js";
import { Stats } from "./Stats.js";
import { Summary } from "./Summary.js";
import { TheOne } from "./TheOne.js";

const SPINNER = ["⠚", "⠓", "⠋", "⠙"]; // the old braille dots on a 2×2 square: the gap goes round
const TICK_MS = 250; // the steady redraw: slow enough to stay idle for hours, fast enough for the spinner
const SLEEP_AFTER_MS = 3 * 60_000; // no key pressed for this long while waiting → the dragon dozes off
const PAUSED_SLEEP_AFTER_MS = 15_000; // during a pause or quiet hours it nods off again much sooner
const SETTLE_MS = 400; // keys right after a card appears or its answer is revealed are a double press, not a choice
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
      <${Text} dimColor>${t("quiz.youWrote")}<//>
      ${parts.map((p, i) => html`<${Text} key=${i} color=${p.ok ? theme.good : theme.text} underline=${!p.ok}>${p.ch}<//>`)}
    <//>
  `;
}

function Verdict({ outcome, question }) {
  const wrong = outcome.result === "wrong";
  const showDiff = outcome.closest && outcome.given && !outcome.overruled && (wrong || outcome.result === "typo");
  return html`
    <${Box} flexDirection="column">
      <${Text} color=${wrong ? theme.bad : theme.good} bold>${wrong ? "✗" : "✓"} ${question.expected.join(" / ")}${outcome.result === "typo" ? t("quiz.closeEnough") : ""}<//>
      ${showDiff && html`<${AnswerDiff} given=${outcome.given} closest=${outcome.closest} />`}
      ${question.word.example && html`<${Box} marginTop=${1}>${question.tour ? html`<${Marked} dimColor text=${question.word.example} />` : html`<${Text} dimColor italic>“${question.word.example}”<//>`}<//>`}
      ${(outcome.hinted || outcome.overruled) &&
      html`
        <${Box} marginTop=${1} flexDirection="column">
          ${outcome.hinted && html`<${Text} dimColor>${t("quiz.hintUsed")}<//>`}
          ${outcome.overruled && html`<${Text} color=${theme.good}>${t("quiz.countedCorrect")}${question.tour ? "" : t("quiz.acceptedFromNow", { answer: outcome.accepted })}<//>`}
        <//>
      `}
    <//>
  `;
}

// the answer shown after an empty Enter, and the question that follows: did you know it?
function Revealed({ question, nudge }) {
  return html`
    <${Box} flexDirection="column">
      <${Text} color=${theme.accent} bold>${question.expected.join(" / ")}<//>
      ${question.word.example && html`<${Box} marginTop=${1}>${question.tour ? html`<${Marked} dimColor text=${question.word.example} />` : html`<${Text} dimColor italic>“${question.word.example}”<//>`}<//>`}
      <${Box} marginTop=${1}>
        <${Text} bold>${t("quiz.didYouKnow")}  <//>
        <${Text} color=${nudge ? theme.warn : theme.text} bold=${nudge}>${t("quiz.gradeKeys")}<//>
      <//>
    <//>
  `;
}

const BADGE_FIRST_MS = 400; // after the answer's own sound
const BADGE_STAGGER_MS = 700; // several badges at once light up one after another

function Cheers({ cheers, play }) {
  const lines = cheers.filter((cheer) => cheer.kind !== "badge");
  const badges = cheers.filter((cheer) => cheer.kind === "badge");
  return html`
    <${Box} flexDirection="column" paddingX=${1} marginTop=${1}>
      ${lines.map((cheer, i) => {
        const style = CHEER_STYLE[cheer.kind] ?? CHEER_STYLE.combo;
        return html`<${Text} key=${i} color=${style.color} bold>${style.icon} ${cheer.text}<//>`;
      })}
      ${badges.map((badge, i) => html`<${BadgeUnlock} key=${badge.id} ...${badge} delay=${BADGE_FIRST_MS + i * BADGE_STAGGER_MS} sound=${badgeSound(i)} play=${play} />`)}
    <//>
  `;
}

// The card's top edge with the direction ("EN → PL") set into its right corner, like a title on the border
function CardTop({ label, width, color }) {
  const tail = 2;
  const room = Math.max(4, width - 2 - tail - 4); // a label too long for a narrow window is cut short
  const tag = ` ${cutToWidth(label, room)} `;
  const dashes = Math.max(0, width - 2 - cellWidth(tag) - tail);
  return html`
    <${Text}>
      <${Text} color=${color}>╭${"─".repeat(dashes)}<//>
      <${Text} dimColor>${tag}<//>
      <${Text} color=${color}>${"─".repeat(tail)}╮<//>
    <//>
  `;
}

// "at 14:30", "tomorrow", "on 14 Oct"
function whenDue(at, now) {
  const tomorrow = startOfTomorrow(now);
  if (at < tomorrow) return t("quiz.when.at", { time: formatClock(at) });
  return at < startOfTomorrow(tomorrow) ? t("quiz.when.tomorrow") : t("quiz.when.on", { day: formatDay(dayKey(at)) });
}

// what the quiz shows when the deck has nothing to ask: no countdown, just the way on
function EmptyDeck({ deck, tour, count, nextDue, dayDone, now, width }) {
  const [title, next] = tour
    ? [t("quiz.empty.tourTitle"), t("quiz.empty.tourNext")]
    : !count
      ? [t("quiz.empty.noCardsTitle", { deck }), t("quiz.empty.noCardsNext")]
      : nextDue >= startOfTomorrow(now) && !dayDone
        ? [t("quiz.empty.deckDoneTitle", { deck }), t("quiz.empty.deckDoneNext", { when: whenDue(nextDue, now) })]
        : nextDue >= startOfTomorrow(now)
        ? [t("quiz.empty.dayDoneTitle"), t("quiz.empty.dayDoneNext", { when: whenDue(nextDue, now) })]
        : [t("quiz.empty.laterTitle"), t("quiz.empty.laterNext", { when: whenDue(nextDue, now) })];
  return html`
    <${Box} flexDirection="column" width=${width}>
      <${CardTop} label=${deck} width=${width} color=${theme.accent} />
      <${Box} flexDirection="column" borderStyle="round" borderTop=${false} borderColor=${theme.accent} paddingX=${2} paddingY=${1}>
        <${Text} bold>${title}<//>
        <${Text}>${next}<//>
      <//>
    <//>
  `;
}

function TipBox({ tip, width }) {
  return html`
    <${Box} flexDirection="column" paddingX=${1} marginTop=${2} width=${width}>
      <${Box} marginBottom=${1}><${Text} color=${theme.accent}>${t("quiz.tip", { cat: tip.cat })}<//><//>
      <${Typewriter} text=${tip.text} dimColor />
    <//>
  `;
}

// `library` holds the /add actions (src/manage.js) and `onSwitchDeck` points the session at another
// deck; the preview gallery passes neither.
export function App({ session, deck: initialDeck, initialSettings, alerts, persistSettings, onExit, library, onSwitchDeck }) {
  const { exit: exitApp } = useApp();
  const exit = onExit ?? exitApp; // the preview gallery runs the quiz as a scene and takes quitting back to its menu
  const { stdout } = useStdout();
  const [settings, setSettings] = useState(initialSettings);
  const [deck, setDeck] = useState(initialDeck);
  const [addNew, setAddNew] = useState(false); // /add opened from "+ New deck" in /decks
  const [restUntil, setRestUntil] = useState(null); // nothing is waiting until then (after the last card due now)
  const [empty, setEmpty] = useState(null); // { tour, count, nextDue } when there is nothing to ask right now
  // quiz | settings | reset | add | decks | stats | badges | companion | help | missed | evolve | the-one | die | summary | hatch
  const [screen, setScreen] = useState(() => (session.isFirstRun() ? "hatch" : "quiz"));
  const [tip, setTip] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | asking | grading (answer revealed) | waiting | empty
  const [nudge, setNudge] = useState(false); // Enter while grading: the 1/2 keys light up
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
  const shownAt = useRef(0); // when the card or its revealed answer appeared (SETTLE_MS)
  const sessionDone = useRef(0); // cards answered in this study session (the "session" rhythm)
  const [sessionWait, setSessionWait] = useState(false); // waiting for Enter, not for the clock
  const asleepRef = useRef(false);
  const bestCombo = useRef(0);
  const settingsRef = useRef(settings);
  const tourSync = useRef(Promise.resolve());
  const deckRef = useRef(deck);
  deckRef.current = deck;
  settingsRef.current = settings;
  const snoozeRef = useRef(0);
  snoozeRef.current = snoozeUntil;

  // when questions may resume: the end of a snooze or of quiet hours, whichever is later; 0 = not paused
  const pauseEnd = (t) => {
    const quiet = settingsRef.current.quiet;
    return Math.max(snoozeRef.current > t ? snoozeRef.current : 0, inQuietHours(t, quiet) ? quietEnd(t, quiet) : 0);
  };

  // `nextDue`: nothing is waiting until then, so the next question waits for it (never sooner than usual).
  // In a study session Enter asks the next card instead of the clock, until the set number is done.
  const waitForNext = useCallback((nextDue = null) => {
    const usual = Date.now() + settingsRef.current.everyMs;
    const length = sessionLength(settingsRef.current.rhythm);
    const studying = settingsRef.current.rhythm !== "minutes" && !nextDue && (length === null || sessionDone.current < length);
    setSessionWait(studying);
    setNextAt(studying ? Infinity : nextDue ? Math.max(nextDue, usual) : usual);
    setRestUntil(nextDue);
    setPhase("waiting");
    setTip(!session.inTour() && shouldShowTip(settingsRef.current.tips) ? session.nextTip() : null);
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
      setEmpty(null);
      shownAt.current = Date.now();
      setPhase("asking");
    } catch (err) {
      if (!err.empty) {
        setProblem(err.message);
        return waitForNext();
      }
      setQuestion(null);
      setEmpty({ tour: err.tour, count: err.count, nextDue: err.nextDue, dayDone: err.dayDone });
      setOutcome(err.cheers.length ? { result: "done", cheers: err.cheers } : null);
      if (err.cheers.length) celebrate({ result: "exact", cheers: err.cheers, combo: session.totals.combo });
      setPhase("empty");
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

  // with nothing to practise, the quiz picks up again by itself once the next card is due
  useEffect(() => {
    if (phase !== "empty" || !empty?.nextDue || screen !== "quiz" || now < empty.nextDue || pauseEnd(now)) return;
    alerts.ask();
    ask();
  }, [now, phase, empty, screen, ask, alerts]);

  useEffect(() => {
    if (phase !== "waiting" || screen === "summary" || screen === "evolve" || screen === "the-one" || screen === "die") return;
    if (now >= nextAt && !pauseEnd(now)) {
      alerts.ask();
      ask();
    }
  }, [now, phase, nextAt, screen, ask, alerts]);

  // Esc on an empty line is easy to press by habit: it quits only when pressed twice in a row
  const escArmed = useRef(0);
  const escapeExit = () => {
    if (Date.now() - escArmed.current < 3000) return requestExit();
    escArmed.current = Date.now();
    setNotice(t("quiz.escAgain"));
  };

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

  // the answer is revealed: you say whether you knew it. 1/2 or ←/→ (AZERTY's digits need Shift, so
  // & and é too); Esc is "didn't know"; Enter never grades, it only shows the keys again
  useInput((input, key) => {
    if (screen !== "quiz" || phase !== "grading" || asleepRef.current || Date.now() - shownAt.current < SETTLE_MS) return;
    if (input === "1" || input === "&" || key.leftArrow || key.escape) return gradeSelf(false);
    if (input === "2" || input === "é" || key.rightArrow) return gradeSelf(true);
    if (key.return) setNudge(true);
  });

  useInput((input, key) => {
    if (screen !== "quiz" || (phase !== "waiting" && phase !== "empty") || commandMode) return;
    if (input === "/") return setCommandMode(true);
    if (input === "q") return requestExit();
    if (key.escape) return escapeExit();
    if (key.return && phase === "waiting") ask();
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
    if (name === "/missed") return setScreen("missed");
    if (name === "/help") return setScreen("help");
    if (name === "/add") return library ? (setAddNew(false), setScreen("add")) : setNotice(t("quiz.previewNoAdd"));
    if (name === "/decks") return library ? setScreen("decks") : setNotice(t("quiz.previewNoDecks"));
    if (name === "/hint" && phase === "asking") return setHintLevel((level) => level + 1);
    if (name === "/pause") {
      return session
        .pause(args)
        .then(({ snooze, list, message }) => {
          if (snooze === "off") setSnoozeUntil(0);
          if (typeof snooze === "number") {
            setSnoozeUntil(Date.now() + snooze);
            return phase === "asking" ? setNotice(t("quiz.pausedUntilNotice", { time: formatClock(Date.now() + snooze) })) : undefined; // while waiting, the status line says it
          }
          const paused = list && snoozeRef.current > Date.now() ? t("quiz.pausedUntilList", { time: formatClock(snoozeRef.current) }) : "";
          setNotice(paused + message);
        })
        .catch((err) => setProblem(err.message));
    }
    if (name === "/correct" && session.canOverrule()) {
      return session
        .overrule()
        .then((result) => {
          setOutcome(result);
          celebrate(result);
          if (phase === "empty") return ask(); // the card's next date changed: look again
          waitForNext(result.nextDue);
        })
        .catch((err) => setProblem(t("quiz.saveFailed", { error: err.message })));
    }
    setProblem(t("quiz.unknownCommand", { name }));
  }

  function changeSettings(patch) {
    const previous = settingsRef.current;
    const next = { ...previous, ...patch };
    settingsRef.current = next;
    setSettings(next);
    alerts.configure({ sound: next.sound, volume: next.volume });
    persistSettings(patch).catch(() => {});
    if (patch.everyMs && phase === "waiting") setNextAt((at) => at - previous.everyMs + patch.everyMs);
    if (patch.rhythm) {
      sessionDone.current = 0;
      if (phase === "waiting" && !restUntil) waitForNext(); // the wait follows the new rhythm right away
    }
    if (patch.volume !== undefined || patch.sound === true) alerts.play("correct-0"); // audible preview
    if (patch.language) changeLanguage(patch.language);
  }

  // Every text follows at the next render; the tour is translated too, and asked again in the new
  // language. One translation at a time, so flicking through languages ends on the last one.
  function changeLanguage(lang) {
    setLanguage(lang);
    if (!library) return;
    tourSync.current = tourSync.current
      .then(() => library.matchTourLanguage())
      .then((renamed) => {
        if (!renamed) return;
        if (deckRef.current === renamed.from) {
          deckRef.current = renamed.to;
          onSwitchDeck?.(renamed.to);
          setDeck(renamed.to);
        }
        if (phase === "asking" && question?.tour) ask();
      })
      .catch(() => {});
  }

  // An empty answer reveals the card, and you grade yourself (gradeSelf). An empty Enter right after the
  // card appeared is the second half of the Enter that asked it: ignored.
  async function submit(raw) {
    const text = raw.trim();
    if (busy.current) return;
    if (!text) {
      if (Date.now() - shownAt.current < SETTLE_MS) return;
      session.reveal(question);
      shownAt.current = Date.now();
      setNudge(false);
      return setPhase("grading");
    }
    await settle(() => session.answer(question, text, { hinted: hintLevel > 0 }));
  }

  const gradeSelf = (knew) => settle(() => session.selfGrade(question, knew, { hinted: hintLevel > 0 }));

  // a graded answer: the verdict, the celebration, then the wait for the next card
  async function settle(grading) {
    if (busy.current) return;
    busy.current = true;
    let nextDue = null;
    try {
      const result = await grading();
      nextDue = result.nextDue;
      sessionDone.current += 1;
      const length = sessionLength(settingsRef.current.rhythm);
      if (length !== null && sessionDone.current === length) setNotice(t("quiz.sessionDone", { count: length }));
      setOutcome(result);
      celebrate(result);
    } catch (err) {
      setProblem(t("quiz.saveFailed", { error: err.message }));
    } finally {
      busy.current = false;
      waitForNext(nextDue);
    }
  }

  // /decks and a first deck from /add: quiz another deck from now on, and remember it
  function switchDeck(name) {
    setScreen("quiz");
    if (name === deck) return;
    onSwitchDeck?.(name);
    setDeck(name);
    changeSettings({ deck: name });
    ask();
  }

  // Reset (from /settings), after a backup. Everything brings back the tour and the hatching egg.
  async function reset(scope) {
    await library.backupBeforeReset();
    await session.reset(scope);
    setFreshBadges([]);
    if (scope === "progress") {
      setScreen("quiz");
      return setNotice(t("quiz.progressReset"));
    }
    const tour = await library.resetLibrary();
    onSwitchDeck?.(tour);
    setDeck(tour);
    changeSettings({ deck: null });
    setScreen("hatch");
    ask();
  }

  // after /add: a first deck of your own replaces the tour; a deck started from /decks (or in place
  // of an empty one) becomes the one you practise; new cards end an empty state
  function addDone({ deck: started, removed, stale = [], added, dropped }) {
    setScreen("quiz");
    if (removed.length) session.forget(removed).catch(() => {});
    if (stale.length) session.forgetKeys(stale).catch(() => {});
    const switching = started && (removed.length || phase === "empty" || addNew);
    if (switching) switchDeck(started);
    else if (phase === "empty" && added) ask();
    const notes = [dropped && t("quiz.cardNotSaved"), started && !switching && t("quiz.deckReadyElsewhere", { deck: started, current: deck })];
    setNotice(notes.filter(Boolean).join(" ")); // after ask(), which clears the notice
  }

  const width = usePanelWidth();
  const border = !outcome ? theme.accent : outcome.result === "wrong" ? theme.bad : theme.good;
  const pausedUntil = pauseEnd(now);
  const tick = Math.floor(now / TICK_MS);
  const frame = SPINNER[tick % SPINNER.length];
  const stats = session.stats();
  // mood: how the last answer went, otherwise whether today's goal is done (Header adds the blinking)
  const resting = stats.today.goalMet ? "smile" : "idle";
  const face = outcome?.result === "wrong" ? "sad" : outcome ? "happy" : resting;
  // strictly boolean: a bare 0 leaking into the markup crashes Ink ("Text string must be rendered inside <Text>")
  const paused = pausedUntil > nextAt || (now >= nextAt && pausedUntil > 0);
  // asleep: no key pressed for a while, whether a question is open or not; a key always wakes it,
  // even during a pause or quiet hours (where it nods off again sooner)
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
  if (screen === "companion") return html`<${Box} flexDirection="column" marginY=${1}><${Companion} current=${stats.companion.index} best=${stats.streak.best} element=${stats.companion.element} roll=${stats.companion.roll} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "help") return html`<${Box} flexDirection="column" marginY=${1}><${Help} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "missed") return html`<${Box} flexDirection="column" marginY=${1}><${Missed} getMissed=${session.missed} onClose=${() => setScreen("quiz")} /><//>`;
  if (screen === "badges") return html`<${Box} flexDirection="column" marginY=${1}><${Badges} badges=${stats.badges} fresh=${freshBadges} onClose=${() => setScreen("quiz")} /><//>`;

  return html`
    <${Box} flexDirection="column" marginY=${1}>
      <${Header} deck=${deck} everyMs=${settings.everyMs} wordCount=${question?.wordCount ?? empty?.count} stats=${stats} combo=${session.totals.combo} face=${face} event=${petEvent} tick=${tick} asleep=${asleep} />
      <${Box} marginTop=${1} flexDirection="column">
        ${screen === "settings" && html`<${Settings} settings=${settings} onChange=${changeSettings} onClose=${() => setScreen("quiz")} onAction=${library ? () => setScreen("reset") : null} />`}
        ${screen === "reset" && html`<${Reset} stats=${stats} actions=${library} onConfirm=${reset} onClose=${() => setScreen("settings")} />`}
        ${screen === "add" && html`<${AddCard} current=${deck} actions=${library} onDone=${addDone} startNew=${addNew} />`}
        ${screen === "decks" && html`<${Decks} current=${deck} actions=${library} onDirections=${async (cardIds, directions) => {
          await session.setDirections(cardIds, directions);
          if (phase === "asking" && question && cardIds.includes(question.word.noteId)) ask(); // the open card follows the new way at once
        }} onPick=${switchDeck} onNew=${() => (setAddNew(true), setScreen("add"))} onClose=${() => setScreen("quiz")} />`}
        ${!["settings", "reset", "add", "decks"].includes(screen) &&
          html`
              <${Fragment}>
              ${question &&
              html`
                <${Box} flexDirection="column" width=${width}>
                  <${CardTop} label=${question.label} width=${width} color=${border} />
                  <${Box} flexDirection="column" borderStyle="round" borderTop=${false} borderColor=${border} paddingX=${2} paddingTop=${1}>
                    <${Marked} bold text=${question.prompt} plain=${!question.tour} />
                    ${question.context && html`<${Text} dimColor>(${question.context})<//>`}
                    ${phase === "asking" && hintLevel > 0 && html`<${Text} dimColor>${t("quiz.hintLabel")}   ${makeHint(hintTarget(question.expected), hintLevel)}<//>`}
                    <${Box} marginTop=${1} flexDirection="column">
                      ${phase === "asking" && html`<${AnswerInput} key=${question.word.noteId + question.direction} onSubmit=${submit} onCommand=${runCommand} onExit=${escapeExit} onEdit=${clearProblem} commands=${commandsFor({ phase: "asking" })} />`}
                      ${phase === "grading" && html`<${Revealed} question=${question} nudge=${nudge} />`}
                      ${phase !== "asking" && phase !== "grading" && outcome && html`<${Verdict} outcome=${outcome} question=${question} />`}
                    <//>
                  <//>
                <//>
              `}
              ${phase === "empty" && html`<${EmptyDeck} deck=${deck} ...${empty} now=${now} width=${width} />`}
              ${confetti && html`<${Confetti} width=${width} onDone=${() => setConfetti(false)} />`}
              ${outcome?.cheers?.length > 0 && html`<${Cheers} cheers=${outcome.cheers} play=${alerts.play} />`}
              ${phase === "waiting" && tip && html`<${TipBox} tip=${tip} width=${width} />`}
              <${Box} paddingX=${1} marginTop=${1} flexDirection="column">
                ${problem && html`<${Text} color=${theme.bad}>${problem}<//>`}
                ${phase === "loading" && html`<${Text}><${Text} color=${theme.accent}>${frame}<//><${Text} dimColor>${t("quiz.loading")}<//><//>`}
                ${notice && html`<${Text} color=${theme.accent}>${notice}<//>`}
                ${phase === "waiting" && paused && html`<${Text} dimColor>${t("quiz.pausedUntil", { time: formatClock(pausedUntil) })}${inQuietHours(now, settings.quiet) ? t("quiz.quietHours") : ""}<//>`}
                ${phase === "waiting" && !paused && restUntil && nextAt - now > settings.everyMs && html`<${Text} dimColor>${t("quiz.nothingWaiting", { when: whenDue(restUntil, now) })}<//>`}
                ${phase === "waiting" && !paused && sessionWait && sessionLength(settings.rhythm) && html`<${Text} dimColor>${t("quiz.sessionProgress", { done: sessionDone.current, count: sessionLength(settings.rhythm) })}<//>`}
                ${phase === "waiting" &&
                !paused &&
                !sessionWait &&
                !(restUntil && nextAt - now > settings.everyMs) &&
                html`
                  <${Text}>
                    <${Text} color=${theme.accent}>${frame} <//>
                    <${Bar} value=${Math.max(0, nextAt - now)} max=${settings.everyMs} width=${14} color="#6b5e8a" />
                    <${Text} dimColor>${t("quiz.nextCardIn", { time: clock(nextAt - now) })}<//>
                  <//>
                `}
                ${(phase === "waiting" || phase === "empty") && commandMode && html`<${AnswerInput} commandOnly initial="/" commands=${commandsFor({ phase: "waiting", canOverrule: session.canOverrule() })} onCommand=${runCommand} onCancel=${() => setCommandMode(false)} onEdit=${clearProblem} />`}
                ${phase !== "loading" && !commandMode && html`<${KeyHints} text=${phase === "grading" ? t("keyHints.grading") : phase === "asking" ? t("keyHints.asking") : phase === "empty" ? t("keyHints.empty") : session.canOverrule() ? t("keyHints.correctFirst", { rest: t(sessionWait ? "keyHints.sessionWaiting" : "keyHints.waiting") }) : t(sessionWait ? "keyHints.sessionWaiting" : "keyHints.waiting")} />`}
              <//>
              <//>
            `}
      <//>
    <//>
  `;
}
