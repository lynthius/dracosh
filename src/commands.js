// `only` limits a command to one phase: "asking" (a question is open) or "waiting" (between questions)
export const COMMANDS = [
  { name: "/hint", only: "asking", hint: "Reveal another letter (the card won't climb a box)" },
  { name: "/settings", hint: "Interval, quiet hours, sound, goal, tips" },
  { name: "/stats", hint: "Streak, month calendar and badges summary" },
  { name: "/badges", hint: "All badges and what unlocks them" },
  { name: "/companion", hint: "Your companion's forms and moods" },
  { name: "/tip", aliases: ["/grammar"], hint: "Grammar tip: show a random one" },
  { name: "/missed", hint: "Words you got wrong today" },
  { name: "/snooze", hint: "Pause questions: /snooze 30m, 2h, off" },
  { name: "/vacation", hint: "Days off that keep your streak: 7, 24.12 2.01, off" },
  { name: "/skip", only: "asking", hint: "Skip this word" },
  { name: "/quit", hint: "Exit Dracosh" }
];

const CORRECT = { name: "/correct", hint: "Count my last answer as correct" };

// What the "/" menu offers right now (phase-only commands, and /correct right after a wrong answer)
export function commandsFor({ phase, canOverrule = false }) {
  const base = COMMANDS.filter((command) => !command.only || command.only === phase);
  return canOverrule ? [CORRECT, ...base] : base;
}

// "/s" narrows to commands starting with it (aliases count: "/gram" finds /tip). Arguments are ignored: "/snooze 30m" matches /snooze.
export function matchCommands(value, commands = COMMANDS) {
  const query = value.trim().split(/\s+/)[0].toLowerCase();
  return commands.filter((command) => command.name.startsWith(query) || command.aliases?.some((alias) => alias.startsWith(query)));
}
