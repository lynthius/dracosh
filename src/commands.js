import { t } from "./i18n.js";

// `only` limits a command to one phase: "asking" (a question is open) or "waiting" (between questions)
export const COMMANDS = [
  { name: "/hint", only: "asking", get hint() { return t("commands.hint"); } },
  { name: "/add", get hint() { return t("commands.add"); } },
  { name: "/decks", get hint() { return t("commands.decks"); } },
  { name: "/settings", get hint() { return t("commands.settings"); } },
  { name: "/stats", get hint() { return t("commands.stats"); } },
  { name: "/badges", get hint() { return t("commands.badges"); } },
  { name: "/companion", get hint() { return t("commands.companion"); } },
  { name: "/missed", get hint() { return t("commands.missed"); } },
  { name: "/pause", get hint() { return t("commands.pause"); } },
  { name: "/help", aliases: ["/?"], get hint() { return t("commands.help"); } },
  { name: "/quit", get hint() { return t("commands.quit"); } }
];

const CORRECT = { name: "/correct", get hint() { return t("commands.correct"); } };

// What the "/" menu offers right now (phase-only commands, and /correct right after a wrong answer)
export function commandsFor({ phase, canOverrule = false }) {
  const base = COMMANDS.filter((command) => !command.only || command.only === phase);
  return canOverrule ? [CORRECT, ...base] : base;
}

// "/s" narrows to commands starting with it (aliases count: "/?" finds /help). Arguments are ignored: "/pause 30m" matches /pause.
export function matchCommands(value, commands = COMMANDS) {
  const query = value.trim().split(/\s+/)[0].toLowerCase();
  return commands.filter((command) => command.name.startsWith(query) || command.aliases?.some((alias) => alias.startsWith(query)));
}
