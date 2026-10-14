import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { Choice, choiceHints } from "./Choice.js";
import { LanguagePicker, pairText } from "./Languages.js";
import { isKnown } from "../language.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const DIRECTIONS = ["forward", "backward", "both"];

// /decks: your decks with their card counts; Enter quizzes the chosen one from now on, and
// "+ New deck" starts one (`onNew`). → on a deck of yours: which way it's asked and its languages.
// Renaming and deleting decks come later.
export function Decks({ current, actions, onPick, onNew, onClose, onDirections }) {
  const panel = usePanelWidth();
  const [decks, setDecks] = useState(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(null); // { deck, selected }: a deck's settings
  const [setting, setSetting] = useState(null); // { deck, selected }: the direction being picked
  const [naming, setNaming] = useState(null); // the deck whose languages are being picked
  const saving = useRef(false);
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
    // → into a deck's settings, ← back out of them (Esc works too)
    if (key.leftArrow && !naming) {
      if (setting) return setSetting(null);
      if (menu) return setMenu(null);
    }
    // not while a change is still being saved: the menu would show the deck as it was
    if (key.rightArrow && !menu && !setting && !naming && !saving.current && deck && !deck.tour) {
      setMessage("");
      setMenu({ deck, selected: 0 });
    }
  });

  // progress of a direction turned off stays: turning it back on picks up where it was
  async function setDirections(index) {
    const { deck } = setting;
    setSetting(null);
    setMenu(null);
    if (DIRECTIONS[index] === deck.directions) return; // nothing changed, nothing to say
    saving.current = true;
    try {
      const { cardIds } = await actions.setDirections(deck.name, DIRECTIONS[index]);
      await onDirections?.(cardIds, DIRECTIONS[index]);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, directions: DIRECTIONS[index] } : d)));
      setMessage(t("decks.directionSaved", { deck: deck.name }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  // the menu stays underneath: Esc in the direction or language picker comes back to it
  function openSetting(index) {
    const { deck } = menu;
    setMenu((m) => ({ ...m, selected: index })); // coming back, the cursor is on the row you opened
    if (index === 0) return setSetting({ deck, selected: Math.max(0, DIRECTIONS.indexOf(deck.directions)) });
    if (index === 1) return setNaming(deck);
    setLanguages(null, deck); // detect them from the cards again
  }

  async function setLanguages(languages, deck = naming) {
    setNaming(null);
    setMenu(null);
    saving.current = true;
    try {
      const saved = await actions.setLanguages(deck.name, languages);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, languages: saved } : d)));
      setMessage(languages ? t("languages.saved", { deck: deck.name, pair: pairText(saved) }) : t("languages.detecting", { deck: deck.name }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  const short = (text) => cutToWidth(text, Math.max(12, Math.floor(panel / 2) - 8));
  const directionOptions = (deck) => {
    const [front, back] = deck.sample ? [short(deck.sample.front), short(deck.sample.back.join(" / "))] : [t("decks.front"), t("decks.back")];
    return [
      { label: `${front} → ?`, note: deck.directions === "forward" ? t("languages.current") : "" },
      { label: `${back} → ?`, note: deck.directions === "backward" ? t("languages.current") : "" },
      { label: t("add.bothWays"), note: deck.directions === "both" ? t("languages.current") : "" }
    ];
  };

  if (naming) return html`<${LanguagePicker} deck=${naming.name} sample=${naming.sample} languages=${naming.languages} onDone=${setLanguages} onCancel=${() => setNaming(null)} />`;

  if (setting) return directionPicker();

  if (menu) {
    const { deck } = menu;
    const guessedNote = deck.languages.guessed && deck.cards > 0 ? ` · ${t("languages.guessed")}` : "";
    const how = directionOptions(deck)[Math.max(0, DIRECTIONS.indexOf(deck.directions))].label;
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${deck.name}<//>
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[
                { label: t("decks.askRow"), note: deck.directions === "both" ? t("add.bothWays") : how },
                { label: t("decks.languagesRow"), note: pairText(deck.languages) + guessedNote },
                ...(deck.languages.guessed ? [] : [{ label: t("decks.detectRow") }])
              ]}
              selected=${menu.selected}
              onMove=${(selected) => setMenu((m) => ({ ...m, selected }))}
              onPick=${openSetting}
              onCancel=${() => setMenu(null)}
            />
          <//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.choiceLeft", { choose: t("choice.keys") })} /><//>
      <//>
    `;
  }

  function directionPicker() {
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("add.directionQuestion", { deck: setting.deck.name })}<//>
          <${Box} marginTop=${1}>
            <${Choice} options=${directionOptions(setting.deck)} selected=${setting.selected} onMove=${(selected) => setSetting((s) => ({ ...s, selected }))} onPick=${setDirections} onCancel=${() => setSetting(null)} />
          <//>
          <${Box} marginTop=${1}><${Text} dimColor>${t("decks.progressKept")}<//><//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.choiceLeft", { choose: t("choice.keys") })} /><//>
      <//>
    `;
  }

  // a deck's languages show in the list once the cards tell at least one
  const languagesNote = (d) => (!d.tour && d.cards > 0 && isKnown(d.languages.front) && isKnown(d.languages.back) ? pairText(d.languages) : "");

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("decks.title")}<//>
        ${decks?.length > 0 &&
        html`
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[...decks.map((d) => ({ label: d.name, note: [t("count.cards", { count: d.cards }), languagesNote(d), d.tour && t("decks.tour"), d.name === current && t("decks.now")].filter(Boolean).join(" · ") })), { label: t("decks.newDeck") }]}
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
