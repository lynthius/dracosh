// `only` limits a command to one phase: "asking" (a question is open) or "waiting" (between questions)
export const COMMANDS = [
  { name: "/hint", only: "asking", hint: "Reveal another letter (the card won't climb a box)" },
  { name: "/add", hint: "Add cards to a deck, or start a new one" },
  { name: "/decks", hint: "Switch to another deck, or start a new one" },
  { name: "/settings", hint: "Interval, quiet hours, sound, goal, tips" },
  { name: "/stats", hint: "Streak, month calendar and badges summary" },
  { name: "/badges", hint: "All badges and what unlocks them" },
  { name: "/companion", hint: "Your dragon, its element and the forms ahead" },
  { name: "/missed", hint: "Cards you got wrong today" },
  { name: "/pause", hint: "A break (30m, 2h) or days off (3d, 24.12 2.01)" },
  { name: "/help", aliases: ["/?"], hint: "Keys, how cards come back, the streak" },
  { name: "/quit", hint: "Exit Dracosh" }
];

const CORRECT = { name: "/correct", hint: "Count my last answer as correct" };

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
