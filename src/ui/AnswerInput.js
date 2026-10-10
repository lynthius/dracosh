import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COMMANDS, matchCommands } from "../commands.js";
import { html, theme } from "./kit.js";

function Palette({ matches, selected }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      ${matches.map(
        (command, i) => html`
          <${Box} key=${command.name}>
            <${Text} color=${i === selected ? theme.accent : undefined} bold=${i === selected} dimColor=${i !== selected}>${i === selected ? "❯" : " "} ${command.name.padEnd(12)}<//>
            <${Text} dimColor>${command.hint}<//>
          <//>
        `
      )}
    <//>
  `;
}

// everything after the command name: "/pause 30m" → "30m"
const args = (value) => value.trim().split(/\s+/).slice(1).join(" ");

// Answer line with a movable cursor (←/→, Ctrl+A/E). Typing "/" opens a command palette:
// ↑/↓ choose, Tab completes, Enter runs.
// `commandOnly` is the between-questions variant: it starts at "/" and Esc or erasing the "/" closes it.
// `plain` is a text field with no commands at all ("and/or" is just text there).
export function AnswerInput({ onSubmit, onCommand, onExit, onEdit, onCancel, commands = COMMANDS, initial = "", commandOnly = false, plain = false }) {
  const [value, setValue] = useState(initial);
  const [cursor, setCursor] = useState(initial.length);
  const [selected, setSelected] = useState(0);
  const isCommand = !plain && value.startsWith("/");
  const matches = isCommand ? matchCommands(value, commands) : [];
  const pick = Math.min(selected, Math.max(matches.length - 1, 0));

  const edit = (next, at = next.length) => {
    setValue(next);
    setCursor(Math.max(0, Math.min(at, next.length)));
    setSelected(0);
    onEdit?.();
  };

  useInput((input, key) => {
    if (key.escape) return commandOnly ? onCancel() : value ? edit("") : onExit();
    if (key.return) {
      if (!isCommand) return onSubmit(value);
      const [token, ...rest] = value.trim().split(/\s+/);
      edit("");
      return onCommand(matches[pick]?.name ?? token, rest.join(" "));
    }
    if (key.tab) return matches.length ? edit(`${matches[pick].name}${args(value) ? ` ${args(value)}` : ""}`) : undefined;
    if (key.upArrow) return setSelected(Math.max(0, pick - 1));
    if (key.downArrow) return setSelected(Math.min(matches.length - 1, pick + 1));
    if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
    if (key.backspace || key.delete) {
      if (commandOnly && value.length <= 1) return onCancel();
      if (cursor === 0) return;
      return edit(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
    }
    if (key.ctrl && input === "u") return commandOnly ? onCancel() : edit("");
    if (key.ctrl && input === "a") return setCursor(0);
    if (key.ctrl && input === "e") return setCursor(value.length);
    if (key.ctrl || key.meta || key.pageUp || key.pageDown) return;
    if (input) {
      const typed = input.replace(/[\r\n]+/g, " ");
      edit(value.slice(0, cursor) + typed + value.slice(cursor), cursor + typed.length);
    }
  });

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return html`
    <${Box} flexDirection="column">
      <${Box}>
        <${Text} color=${theme.accent}>❯ <//>
        <${Text}>${before}<${Text} inverse>${at}<//>${after}<//>
      <//>
      ${matches.length > 0 && html`<${Palette} matches=${matches} selected=${pick} />`}
      ${isCommand && matches.length === 0 && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>unknown command<//><//>`}
    <//>
  `;
}
