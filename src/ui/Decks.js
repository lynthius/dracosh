import { Fragment, useEffect, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const DIRECTIONS = ["forward", "backward", "both"];

// /decks: your decks with their card counts; Enter quizzes the chosen one from now on, and
// "+ New deck" starts one (`onNew`). → on a deck of yours: which way it's asked. Renaming and deleting
// decks come later.
export function Decks({ current, actions, onPick, onNew, onClose, onDirections }) {
  const panel = usePanelWidth();
  const [decks, setDecks] = useState(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");
  const [setting, setSetting] = useState(null); // { deck, selected }: the direction being picked
  const [message, setMessage] = useState("");

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
    const deck = decks?.[picked];
    if (key.rightArrow && !setting && deck && !deck.tour) {
      setMessage("");
      setSetting({ deck, selected: Math.max(0, DIRECTIONS.indexOf(deck.directions)) });
    }
  });

  // progress of a direction turned off stays: turning it back on picks up where it was
  async function setDirections(index) {
    const { deck } = setting;
    setSetting(null);
    try {
      const { cardIds } = await actions.setDirections(deck.name, DIRECTIONS[index]);
      await onDirections?.(cardIds, DIRECTIONS[index]);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, directions: DIRECTIONS[index] } : d)));
      setMessage(t("decks.directionSaved", { deck: deck.name }));
    } catch (err) {
      setError(err.message);
    }
  }

  const short = (text) => cutToWidth(text, Math.max(12, Math.floor(panel / 2) - 8));
  const directionOptions = (deck) => {
    const [front, back] = deck.sample ? [short(deck.sample.front), short(deck.sample.back.join(" / "))] : [t("decks.front"), t("decks.back")];
    return [
      { label: `${front} → ?`, note: deck.directions === "forward" ? t("decks.now") : "" },
      { label: `${back} → ?`, note: deck.directions === "backward" ? t("decks.now") : "" },
      { label: t("add.bothWays"), note: deck.directions === "both" ? t("decks.now") : "" }
    ];
  };

  if (setting)
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("add.directionQuestion", { deck: setting.deck.name })}<//>
          <${Box} marginTop=${1}>
            <${Choice} options=${directionOptions(setting.deck)} selected=${setting.selected} onMove=${(selected) => setSetting((s) => ({ ...s, selected }))} onPick=${setDirections} onCancel=${() => setSetting(null)} />
          <//>
          <${Box} marginTop=${1}><${Text} dimColor>${t("decks.progressKept")}<//><//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${choiceHints()} /><//>
      <//>
    `;

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
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${decks?.[picked] && !decks[picked].tour ? t("keyHints.decks", { choose: choiceHints() }) : choiceHints()} /><//>
    <//>
  `;
}
