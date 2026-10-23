import { t } from "../i18n.js";
import { useState } from "react";
import { Box, useInput, usePaste } from "ink";
import { COMMANDS, matchCommands } from "../commands.js";
import { html, Text, theme } from "./kit.js";

function Palette({ matches, selected }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      ${matches.map(
        (command, i) => html`
          <${Box} key=${command.name}>
            <${Box} flexShrink=${0}><${Text} color=${i === selected ? theme.accent : undefined} bold=${i === selected} dimColor=${i !== selected}>${i === selected ? "❯" : " "} ${command.name.padEnd(12)}<//><//>
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
// `plain` is a text field with no commands at all ("and/or" is just text there); `escLeaves`: Esc leaves
// it at once, typed text and all, instead of clearing it first (a name being changed, a path).
// `onChange` hears every edit; `onRecall` is ↑ on an empty plain field (/add brings back the last card);
// `onPaste` takes a paste of several lines, as it came (/add reviews them as cards); anything else is typed in.
// A card line's next part from the cursor: front → back → example → front again. A part that isn't
// there yet is started: "kot" → "kot = ", "kot = cat" → "kot = cat // ". → { value, cursor }
export function nextPart(value, cursor) {
  const end = (text) => ({ value: text, cursor: text.length });
  const eq = value.indexOf(" = ");
  if (eq < 0) return end(`${value.trimEnd()} = `);
  const example = value.indexOf(" // ", eq + 3);
  if (cursor < eq + 3) return { value, cursor: eq + 3 };
  if (example < 0) return end(`${value.trimEnd()} // `);
  if (cursor < example + 4) return { value, cursor: example + 4 };
  return { value, cursor: 0 };
}

// `cardLine`: the field holds a card line ("front = back // example"), and Tab goes to its next part,
// adding the " = " or " // " that starts it
export function AnswerInput({ onSubmit, onCommand, onExit, onEdit, onCancel, onChange, onRecall, onPaste, commands = COMMANDS, initial = "", commandOnly = false, plain = false, escLeaves = false, cardLine = false }) {
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
    onChange?.(next);
  };

  // pasted text arrives whole (bracketed paste); lines become spaces unless /add takes them as cards
  const paste = (text) => {
    const lines = /[\r\n]/.test(text) ? text.split(/\r\n|\r|\n/).filter((line) => line.trim()) : [text];
    if (onPaste && lines.length > 1) return onPaste(text);
    const typed = lines.join(" ").replace(/\t/g, " ");
    edit(value.slice(0, cursor) + typed + value.slice(cursor), cursor + typed.length);
  };
  usePaste(paste);

  useInput((input, key) => {
    if (key.escape) return commandOnly ? onCancel() : value && !escLeaves ? edit("") : onExit();
    if (key.return) {
      // no command starts like this: on a card it's simply the answer (some answers begin with "/")
      if (!isCommand || (!matches.length && !commandOnly)) return onSubmit(value);
      const [token, ...rest] = value.trim().split(/\s+/);
      edit("");
      return onCommand(matches[pick]?.name ?? token, rest.join(" "));
    }
    if (key.tab && cardLine) {
      if (!value.trim()) return;
      const next = nextPart(value, cursor);
      return next.value === value ? setCursor(next.cursor) : edit(next.value, next.cursor);
    }
    if (key.tab) return matches.length ? edit(`${matches[pick].name}${args(value) ? ` ${args(value)}` : ""}`) : undefined;
    if (key.upArrow && !value && onRecall) return onRecall();
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
    // a terminal without bracketed paste sends a paste as typed text, line breaks and all
    if (input) paste(input);
  });

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return html`
    <${Box} flexDirection="column">
      <${Box}>
        <${Box} flexShrink=${0}><${Text} color=${theme.accent}>❯ <//><//>
        <${Text}>${before}<${Text} inverse>${at}<//>${after}<//>
      <//>
      ${matches.length > 0 && html`<${Palette} matches=${matches} selected=${pick} />`}
      ${isCommand && matches.length === 0 && html`<${Box} marginTop=${1}>${commandOnly ? html`<${Text} color=${theme.bad}>${t("input.unknownCommand")}<//>` : html`<${Text} dimColor>${t("input.notACommand")}<//>`}<//>`}
    <//>
  `;
}
