import { Fragment, useEffect, useState } from "react";
import { Box } from "ink";
import { MAX_DECK_NAME } from "../library.js";
import { slashAnswer, slashFront } from "../manage.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { t } from "../i18n.js";
import { html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const FIELDS = ["deck", "front", "back", "example"]; // label and hint: add.fields.<name> in the locale

const splitAnswers = (text) => text.split(",").map((part) => part.trim()).filter(Boolean);


// /add: a small form inside the app. You pick one of your decks or start a new one (your first one
// replaces the tour), then add cards one after another until Esc. `actions` reads and writes the library.
// `startNew` skips the deck list and goes straight to a new deck ("+ New deck" in /decks).
export function AddCard({ current, actions, onDone, startNew = false }) {
  const panel = usePanelWidth();
  const [step, setStep] = useState("loading"); // loading | pick | deck | ways | front | back | example | saving
  const [decks, setDecks] = useState([]);
  const [picked, setPicked] = useState(0);
  const [ways, setWays] = useState(0);
  const [bothWays, setBothWays] = useState(false); // the deck's front is an answer too
  const [deck, setDeck] = useState(null);
  const [newDeck, setNewDeck] = useState(null); // { name, removed } once a first deck was started here
  const [draft, setDraft] = useState({ front: "", back: [] });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [added, setAdded] = useState(0);

  useEffect(() => {
    actions.ownDecks().then(
      (own) => {
        setDecks(own);
        setPicked(Math.max(0, own.findIndex((d) => d.name === current)));
        setStep(own.length && !startNew ? "pick" : "deck");
      },
      (err) => setError(err.message)
    );
  }, []);

  // `dropped`: a card was half written (its front typed) when Esc ended /add
  const finish = () => onDone({ deck: newDeck?.name ?? null, removed: newDeck?.removed ?? [], added, dropped: Boolean(draft.front) && (step === "back" || step === "example") });

  async function startDeck(bothWays) {
    setStep("saving");
    try {
      const { deck: created, removed } = await actions.startDeck({ name: deck, bothWays });
      setDeck(created.name);
      setBothWays(bothWays);
      setNewDeck({ name: created.name, removed });
      setMessage(t("add.deckReady", { deck: created.name }));
      setStep("front");
    } catch (err) {
      setError(err.message);
      setStep("deck");
    }
  }

  async function save(example) {
    setStep("saving");
    try {
      const { duplicate } = await actions.addCardTo(deck, { ...draft, example });
      if (duplicate) setError(t("add.duplicateCard", { front: duplicate.front, deck }));
      else {
        setAdded((n) => n + 1);
        setMessage(t("add.added", { front: draft.front, deck }));
      }
    } catch (err) {
      setError(err.message);
    }
    setDraft({ front: "", back: [] });
    setStep("front");
  }

  function submit(text) {
    const value = text.trim();
    setError("");
    setMessage("");
    if (step === "deck") {
      if (!value) return setError(t("add.needName"));
      if (Array.from(value).length > MAX_DECK_NAME) return setError(t("add.nameTooLong", { max: MAX_DECK_NAME }));
      return actions.existingDeck(value).then((existing) => {
        if (existing) return setError(t("add.duplicateDeck", { deck: existing.name }));
        setDeck(value);
        setStep("ways");
      }, (err) => setError(err.message));
    }
    if (step === "front") {
      if (!value) return setError(t("add.needFront"));
      if (bothWays && value.startsWith("/")) return setError(slashFront());
      return actions.existingCard(deck, value).then((existing) => {
        if (existing) return setError(t("add.duplicateCard", { front: existing.front, deck }));
        setDraft({ front: value, back: [] });
        setStep("back");
      }, (err) => setError(err.message));
    }
    if (step === "back") {
      const answers = splitAnswers(value);
      if (!answers.length) return setError(t("add.needBack"));
      if (answers.some((a) => a.startsWith("/"))) return setError(slashAnswer());
      setDraft((d) => ({ ...d, back: answers }));
      return setStep("example");
    }
    if (step === "example") save(value);
  }

  function pickDeck(index) {
    if (index === decks.length) return setStep("deck");
    setDeck(decks[index].name);
    setBothWays(decks[index].bothWays);
    setStep("front");
  }

  const title = step === "pick" ? t("add.titlePick") : step === "deck" || step === "ways" ? t(decks.length ? "add.titleNew" : "add.titleFirst") : t("add.titleCard", { deck });
  const field = FIELDS.includes(step) ? { label: t(`add.fields.${step}.label`), hint: t(`add.fields.${step}.hint`) } : null;
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${title}<//>
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${draft.front && step !== "front" && html`<${Box} marginTop=${1}><${Text} dimColor>${draft.front}${draft.back.length ? `  →  ${draft.back.join(", ")}` : ""}<//><//>`}
        ${field &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} bold>${field.label}<//>
            <${Text} dimColor>${field.hint}<//>
            <${Box} marginTop=${1}><${AnswerInput} key=${step} plain onSubmit=${submit} onExit=${finish} onEdit=${() => setError("")} /><//>
          <//>
        `}
        ${step === "pick" &&
        html`
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[...decks.map((d) => ({ label: d.name, note: t("count.cards", { count: d.cards }) })), { label: t("decks.newDeck") }]}
              selected=${picked}
              onMove=${setPicked}
              onPick=${pickDeck}
              onCancel=${finish}
            />
          <//>
        `}
        ${step === "ways" &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} bold>${t("add.waysQuestion", { deck })}<//>
            <${Box} marginTop=${1}>
              <${Choice}
                options=${[
                  { label: t("add.bothWays"), note: t("add.bothWaysNote"), key: t("choice.yesKey") },
                  { label: t("add.oneWay"), note: t("add.oneWayNote"), key: t("choice.noKey") }
                ]}
                selected=${ways}
                onMove=${setWays}
                onPick=${(i) => startDeck(i === 0)}
                onCancel=${finish}
              />
            <//>
          <//>
        `}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${step === "pick" || step === "ways" ? choiceHints("cancel") : t(added || newDeck ? "keyHints.addDone" : "keyHints.addNext")} /><//>
    <//>
  `;
}
