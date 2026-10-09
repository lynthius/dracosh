import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, PANEL_WIDTH, theme } from "./kit.js";

// /decks: your decks with their card counts; Enter quizzes the chosen one from now on.
// Creating, renaming and deleting decks come later; a new deck starts in /add.
export function Decks({ current, actions, onPick, onClose }) {
  const [decks, setDecks] = useState(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    actions.allDecks().then(
      (all) => {
        setDecks(all);
        setPicked(Math.max(0, all.findIndex((d) => d.name === current)));
      },
      (err) => setError(err.message)
    );
  }, []);

  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (!decks?.length) return;
    if (key.upArrow) setPicked((i) => Math.max(0, i - 1));
    if (key.downArrow) setPicked((i) => Math.min(decks.length - 1, i + 1));
    if (key.return) onPick(decks[picked].name);
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} bold color=${theme.accent}>Decks<//>
        <${Box} flexDirection="column" marginTop=${1}>
          ${(decks ?? []).map(
            (d, i) => html`
              <${Box} key=${d.name}>
                <${Text} color=${i === picked ? theme.accent : undefined} bold=${i === picked}>${i === picked ? "❯" : " "} ${d.name.padEnd(24)}<//>
                <${Text} dimColor>${d.cards} card${d.cards === 1 ? "" : "s"}${d.tour ? " · the tour" : ""}${d.name === current ? " · now" : ""}<//>
              <//>
            `
          )}
        <//>
        <${Box} marginTop=${1}><${Text} dimColor>A new deck starts in /add.<//><//>
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>↑/↓ choose · enter practise this deck · esc back<//><//>
    <//>
  `;
}
