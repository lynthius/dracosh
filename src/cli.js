#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { createAlerts } from "./alerts.js";
import { existsSync } from "node:fs";
import { language, setLanguage, t } from "./i18n.js";
import { BACKUP_DIR, dailyBackup, listBackups, restoreBackup } from "./backup.js";
import { ensureProgress, snapshot } from "./progress.js";
import { BOX_INTERVALS_DAYS } from "./scheduler.js";
import { createSession } from "./session.js";
import { DEFAULTS, formatInterval, normalizeSettings } from "./settings.js";
import { seedLibrary } from "./starter.js";
import { DATA_FILES, HOME, loadLibrary, loadSettingsRaw, loadState, patchSettings, saveLibrary } from "./store.js";
import { App } from "./ui/App.js";
import { Preview } from "./ui/Preview.js";
import { ALREADY_RUNNING, acquireLock, runningPid } from "./lock.js";
import * as manage from "./manage.js";
import { findDeck } from "./library.js";
import { loadAllWords, loadWords, missingDeck } from "./words.js";
import { runExport, runImport } from "./transfer.js";

const help = () => t("cli.help", { interval: formatInterval(DEFAULTS.everyMs), volume: DEFAULTS.volume });

function parseEvery(value) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value);
  if (!match) throw new Error(t("cli.badEvery", { value }));
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
}

function parseVolume(value) {
  const volume = Number(value);
  if (!(volume >= 0 && volume <= 1)) throw new Error(t("cli.badVolume", { value }));
  return volume;
}

function printStats(state, settings) {
  ensureProgress(state);
  const stats = snapshot(state, { goal: settings.dailyGoal });
  const { streak, today } = stats;
  console.log(t("cli.stats.streak", { days: streak.days, best: streak.best, count: streak.freezes }));
  console.log(t("cli.stats.today", { correct: today.correct, goal: stats.goal, goal_reached: today.goalMet ? t("cli.stats.goalReached") : "" }));
  console.log(t("cli.stats.badges", { unlocked: stats.badges.filter((b) => b.unlockedOn).length, total: stats.badges.length, mastered: stats.mastered, companion: stats.companion.name }));

  const entries = Object.values(state.items);
  if (!entries.length) return;
  const perBox = BOX_INTERVALS_DAYS.map((days, i) => t("cli.stats.box", { box: i + 1, days, count: entries.filter((e) => e.box === i + 1).length }));
  const correct = entries.reduce((sum, e) => sum + e.correct, 0);
  const total = entries.reduce((sum, e) => sum + e.seen, 0);
  console.log(t("cli.stats.practised", { count: entries.length, correct, total, percent: Math.round((correct / total) * 100) }));
  console.log(perBox.join("  "));
}

const formatTime = (ms) => new Date(ms).toLocaleString("sv").slice(0, 16);

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${t("cli.restore.askSuffix")} `)).trim().toLowerCase();
    return t("cli.restore.yes").split("|").includes(answer);
  } finally {
    rl.close();
  }
}

// --data: where everything lives, and what's in it
async function printData() {
  const library = await loadLibrary();
  const state = await loadState();
  const backups = await listBackups();
  const missing = (file) => (existsSync(file) ? "" : t("cli.data.notCreated"));
  console.log(`${t("cli.data.where", { home: HOME })}\n`);
  console.log(t("cli.data.library", { decks: t("count.decks", { count: library.decks.length }), cards: t("count.cards", { count: library.cards.length }), missing: missing(DATA_FILES.library) }));
  console.log(t("cli.data.state", { count: Object.keys(state.items).length, missing: missing(DATA_FILES.state) }));
  console.log(t("cli.data.settings", { missing: missing(DATA_FILES.settings) }));
  const what = backups.length ? t("cli.data.backupsSome", { backups: t("cli.backups", { count: backups.length }), time: formatTime(backups[0].created) }) : t("cli.data.none");
  console.log(t("cli.data.backups", { what }));
  console.log(`\n${t("cli.data.footer")}`);
}

async function restore(choice, { yes }) {
  const backups = await listBackups();
  if (!backups.length) return console.log(t("cli.restore.none", { dir: BACKUP_DIR }));
  if (!choice) {
    console.log(`${t("cli.restore.listTitle", { dir: BACKUP_DIR })}\n`);
    const reason = (b) => t(`cli.restore.reasons.${b.reason}`);
    const width = Math.max(...backups.map((b) => reason(b).length));
    backups.forEach((b, i) => {
      const what = t("cli.restore.row", { decks: t("count.decks", { count: b.decks }), cards: t("count.cards", { count: b.cards }), practised: b.practiced });
      console.log(`  ${String(i + 1).padStart(2)}  ${formatTime(b.created)}  ${reason(b).padEnd(width)}  ${what}`);
    });
    return console.log(`\n${t("cli.restore.howTo")}`);
  }

  const backup = backups[Number(choice) - 1];
  if (!backup) throw new Error(t("cli.restore.noSuch", { number: choice }));
  const running = runningPid();
  if (running) throw new Error(ALREADY_RUNNING(running));
  const has = ["cards", "progress", "settings"].filter((_, i) => [backup.cards || backup.decks, backup.hasState, backup.hasSettings][i]);
  const what = new Intl.ListFormat(language(), { type: "conjunction" }).format(has.map((part) => t(`cli.restore.what.${part}`)));
  console.log(t("cli.restore.bringsBack", { what, time: formatTime(backup.created) }));
  console.log(t("cli.restore.undo"));
  if (!yes) {
    if (!process.stdin.isTTY) throw new Error(t("cli.restore.needsYes"));
    if (!(await confirm(t("cli.restore.ask")))) return console.log(t("cli.restore.nothingChanged"));
  }
  await restoreBackup(backup.file);
  console.log(t("cli.restore.done"));
}

async function main() {
  setLanguage(normalizeSettings(await loadSettingsRaw().catch(() => ({}))).language);
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      deck: { type: "string" },
      separator: { type: "string" },
      encoding: { type: "string" },
      update: { type: "boolean", default: false },
      anki: { type: "boolean", default: false },
      split: { type: "boolean", default: false },
      every: { type: "string" },
      volume: { type: "string" },
      "no-sound": { type: "boolean", default: false },
      stats: { type: "boolean", default: false },
      data: { type: "boolean", default: false },
      preview: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) return console.log(help());
  const [command, ...args] = positionals;
  if (command === "restore") return restore(args[0], values);
  if ((command === "import" || command === "export") && args.length > 1) throw new Error(t("cli.oneFile", { command }));
  if (command === "import") return runImport(args[0], values);
  if (command === "export") return runExport(args[0], values);
  if (command) throw new Error(t("cli.unknownCommand", { command }));
  if (values.data) return printData();

  const saved = normalizeSettings(await loadSettingsRaw());
  const settings = {
    ...saved,
    ...(values.every && { everyMs: parseEvery(values.every) }),
    ...(values.volume && { volume: parseVolume(values.volume) }),
    ...(values["no-sound"] && { sound: false })
  };

  if (values.preview) {
    if (!process.stdin.isTTY) throw new Error(t("cli.needsTerminal"));
    const alerts = createAlerts({ sound: settings.sound, volume: settings.volume, speak: settings.speak });
    return render(React.createElement(Preview, { alerts })).waitUntilExit();
  }

  const state = await loadState();
  if (values.stats) return printStats(state, settings);
  if (!process.stdin.isTTY) throw new Error(t("cli.needsTerminal"));
  // a fresh install starts with the "Getting started" deck
  const library = await loadLibrary();
  const seeded = seedLibrary(library);
  if (values.deck && !findDeck(library, values.deck)) throw missingDeck(library, values.deck); // before anything is written

  acquireLock();
  await dailyBackup();
  if (seeded) await saveLibrary(library);

  // --deck must exist (fail fast, before taking over the screen); a deck saved in /decks that has
  // since gone just falls back to the first one
  const { deck } = values.deck ? await loadWords(values.deck) : await loadWords(settings.deck).catch(() => loadWords());

  let current = settings; // the session reads settings live, so /settings changes apply immediately
  let active = deck.name; // /add can switch to your first own deck
  const session = createSession({ loadWords: () => loadWords(active), loadAllWords, state, getSettings: () => current });
  const alerts = createAlerts({ sound: settings.sound, volume: settings.volume, speak: settings.speak });
  const persistSettings = async (patch) => {
    current = { ...current, ...patch };
    await patchSettings(patch);
  };

  // the session summary screen stays on screen after exit, so nothing more to print here
  const app = render(React.createElement(App, { session, deck: deck.name, initialSettings: settings, alerts, persistSettings, library: manage, onSwitchDeck: (name) => (active = name) }));
  await app.waitUntilExit();
}

main().catch((err) => {
  // an option Dracosh doesn't have, said in the app's language
  if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") err.message = t("cli.unknownOption", { option: /'([^']+)'/.exec(err.message)?.[1] ?? "" });
  if (["EACCES", "EPERM", "ENOTDIR", "EEXIST"].includes(err.code)) {
    console.error(t("cli.cantUseFolder", { home: HOME, code: err.code }));
    process.exit(1);
  }
  console.error(err.message);
  process.exit(1);
});
