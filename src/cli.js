#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { parseArgs } from "node:util";
import { createAlerts } from "./alerts.js";
import { ensureProgress, snapshot } from "./progress.js";
import { BOX_INTERVALS_DAYS } from "./scheduler.js";
import { createSession } from "./session.js";
import { DEFAULTS, formatInterval, normalizeSettings } from "./settings.js";
import { seedLibrary } from "./starter.js";
import { loadLibrary, loadSettingsRaw, loadState, patchSettings, saveLibrary } from "./store.js";
import { App } from "./ui/App.js";
import { Preview } from "./ui/Preview.js";
import { loadWords } from "./words.js";

const HELP = `Dracosh: a vocabulary and quiz trainer for your terminal

Usage: dracosh [options]

  --deck <name>    which deck of your library to quiz (default: the first one)
  --every <time>   pause between questions: 30s, 10m, 1h (default: ${formatInterval(DEFAULTS.everyMs)})
  --no-sound       turn sound effects off
  --volume <0-1>   sound volume (default: ${DEFAULTS.volume})
  --stats          print progress and exit
  --preview        browse every animation and screen on made-up data (nothing is saved)
  -h, --help       show this help

Flags override your saved settings for this run only. Change the saved ones with /settings.

While running: Enter submits, "/" opens the command menu (/settings, /stats, /badges, /skip, /quit),
Esc quits (clears the line first if you typed something). Ctrl+C also works.
Between questions: Enter asks the next word right away, q quits.`;

function parseEvery(value) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid --every "${value}". Use e.g. 30s, 10m, 1h.`);
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
}

function parseVolume(value) {
  const volume = Number(value);
  if (!(volume >= 0 && volume <= 1)) throw new Error(`Invalid --volume "${value}". Use a number from 0 to 1.`);
  return volume;
}

function printStats(state, settings) {
  ensureProgress(state);
  const stats = snapshot(state, { goal: settings.dailyGoal });
  const { streak, today } = stats;
  console.log(`Streak ${streak.days} days (best ${streak.best}) · ${streak.freezes} freeze(s) in stock`);
  console.log(`Today ${today.correct}/${stats.goal} correct${today.goalMet ? " ✓ goal reached" : ""}`);
  console.log(`Badges ${stats.badges.filter((b) => b.unlockedOn).length}/${stats.badges.length} · ${stats.mastered} cards mastered · companion: ${stats.companion.name}`);

  const entries = Object.values(state.items);
  if (!entries.length) return;
  const perBox = BOX_INTERVALS_DAYS.map((days, i) => `box ${i + 1} (${days}d): ${entries.filter((e) => e.box === i + 1).length}`);
  const correct = entries.reduce((sum, e) => sum + e.correct, 0);
  const total = entries.reduce((sum, e) => sum + e.seen, 0);
  console.log(`${entries.length} cards practiced, ${correct}/${total} correct (${Math.round((correct / total) * 100)}%)`);
  console.log(perBox.join("  "));
}

async function main() {
  const { values } = parseArgs({
    options: {
      deck: { type: "string" },
      every: { type: "string" },
      volume: { type: "string" },
      "no-sound": { type: "boolean", default: false },
      stats: { type: "boolean", default: false },
      preview: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) return console.log(HELP);

  const saved = normalizeSettings(await loadSettingsRaw());
  const settings = {
    ...saved,
    ...(values.every && { everyMs: parseEvery(values.every) }),
    ...(values.volume && { volume: parseVolume(values.volume) }),
    ...(values["no-sound"] && { sound: false })
  };

  if (values.preview) {
    if (!process.stdin.isTTY) throw new Error("dracosh needs an interactive terminal.");
    const alerts = createAlerts({ sound: settings.sound, volume: settings.volume });
    return render(React.createElement(Preview, { alerts })).waitUntilExit();
  }

  const state = await loadState();
  if (values.stats) return printStats(state, settings);
  if (!process.stdin.isTTY) throw new Error("dracosh needs an interactive terminal.");

  // a fresh install starts with the "Getting started" deck
  const library = await loadLibrary();
  if (seedLibrary(library)) await saveLibrary(library);

  // fail fast (and readably) when there is nothing to quiz on, before taking over the screen
  const { words, deck } = await loadWords(values.deck);
  if (!words.length) throw new Error(`The deck "${deck.name}" has no cards yet.`);

  let current = settings; // the session reads settings live, so /settings changes apply immediately
  const session = createSession({ loadWords: () => loadWords(deck.name), state, getSettings: () => current });
  const alerts = createAlerts({ sound: settings.sound, volume: settings.volume });
  const persistSettings = async (patch) => {
    current = { ...current, ...patch };
    await patchSettings(patch);
  };

  // the session summary screen stays on screen after exit, so nothing more to print here
  const app = render(React.createElement(App, { session, deck: deck.name, initialSettings: settings, alerts, persistSettings }));
  await app.waitUntilExit();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
