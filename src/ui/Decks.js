import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { t } from "../i18n.js";
import { Choice, choiceHints } from "./Choice.js";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";

// /decks: your decks with their card counts; Enter quizzes the chosen one from now on, and
// "+ New deck" starts one (`onNew`). Renaming and deleting decks come later.
export function Decks({ current, actions, onPick, onNew, onClose }) {
  const panel = usePanelWidth();
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
    if (!decks?.length && (key.escape || input === "q")) onClose();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("decks.title")}<//>
        ${decks?.length > 0 &&
        html`
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[...decks.map((d) => ({ label: d.name, note: [t("count.cards", { count: d.cards }), d.tour && t("decks.tour"), d.name === current && t("decks.now")].filter(Boolean).join(" · ") })), { label: t("decks.newDeck") }]}
              selected=${picked}
              onMove=${setPicked}
              onPick=${(i) => (i === decks.length ? onNew() : onPick(decks[i].name))}
              onCancel=${onClose}
            />
          <//>
        `}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${choiceHints()} /><//>
    <//>
  `;
}
