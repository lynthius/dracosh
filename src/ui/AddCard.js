import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { AnswerInput } from "./AnswerInput.js";
import { html, PANEL_WIDTH, theme } from "./kit.js";

const FIELDS = {
  deck: { label: "Name your deck", hint: "Spanish, Biology, Capitals… whatever you want to learn" },
  front: { label: "Front", hint: "the word or question, e.g. gato" },
  back: { label: "Back", hint: "the answer; separate several with commas, e.g. cat, kitty" },
  example: { label: "Example", hint: "optional: a sentence that helps you remember. Enter skips it" }
};

const splitAnswers = (text) => text.split(",").map((part) => part.trim()).filter(Boolean);

const NEW_DECK = "+ New deck";

// /add: a small form inside the app. You pick one of your decks or start a new one (your first one
// replaces the tour), then add cards one after another until Esc. `actions` reads and writes the library.
export function AddCard({ current, actions, onDone }) {
  const [step, setStep] = useState("loading"); // loading | pick | deck | ways | front | back | example | saving
  const [decks, setDecks] = useState([]);
  const [picked, setPicked] = useState(0);
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
        setStep(own.length ? "pick" : "deck");
      },
      (err) => setError(err.message)
    );
  }, []);

  const finish = () => onDone({ deck: newDeck?.name ?? null, removed: newDeck?.removed ?? [], added });

  async function startDeck(bothWays) {
    setStep("saving");
    try {
      const { deck: created, removed } = await actions.startDeck({ name: deck, bothWays });
      setDeck(created.name);
      setNewDeck({ name: created.name, removed });
      setMessage(`Your deck "${created.name}" is ready. Now its first card:`);
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
      if (duplicate) setError(`"${duplicate.front}" is already in ${deck}.`);
      else {
        setAdded((n) => n + 1);
        setMessage(`Added "${draft.front}" to ${deck}. Next card, or Esc to finish.`);
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
      if (!value) return setError("Your deck needs a name.");
      setDeck(value);
      return setStep("ways");
    }
    if (step === "front") {
      if (!value) return setError("A card needs a front.");
      return actions.existingCard(deck, value).then((existing) => {
        if (existing) return setError(`"${existing.front}" is already in ${deck}.`);
        setDraft({ front: value, back: [] });
        setStep("back");
      }, (err) => setError(err.message));
    }
    if (step === "back") {
      const answers = splitAnswers(value);
      if (!answers.length) return setError("A card needs an answer.");
      setDraft((d) => ({ ...d, back: answers }));
      return setStep("example");
    }
    if (step === "example") save(value);
  }

  useInput((input, key) => {
    if (step !== "pick") return;
    if (key.upArrow) setPicked((i) => Math.max(0, i - 1));
    else if (key.downArrow) setPicked((i) => Math.min(decks.length, i + 1));
    else if (key.escape) finish();
    else if (key.return) {
      if (picked === decks.length) return setStep("deck");
      setDeck(decks[picked].name);
      setStep("front");
    }
  });

  useInput((input, key) => {
    if (step !== "ways") return;
    if (input === "y" || key.return) startDeck(true);
    else if (input === "n") startDeck(false);
    else if (key.escape) finish();
  });

  const title = step === "pick" ? "Add cards to…" : step === "deck" || step === "ways" ? (decks.length ? "New deck" : "Start your first deck") : `Add a card · ${deck}`;
  const field = FIELDS[step];
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
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
          <${Box} flexDirection="column" marginTop=${1}>
            ${[...decks.map((d) => ({ label: d.name, note: `${d.cards} card${d.cards === 1 ? "" : "s"}` })), { label: NEW_DECK, note: "" }].map(
              (row, i) => html`
                <${Box} key=${row.label}>
                  <${Text} color=${i === picked ? theme.accent : undefined} bold=${i === picked}>${i === picked ? "❯" : " "} ${row.label.padEnd(24)}<//>
                  <${Text} dimColor>${row.note}<//>
                <//>
              `
            )}
          <//>
        `}
        ${step === "ways" &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} bold>Ask "${deck}" both ways?<//>
            <${Text} dimColor>Yes for words (gato → cat, and cat → gato). No for questions that only make sense one way.<//>
          <//>
        `}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>${step === "pick" ? "↑/↓ choose · enter pick · esc cancel" : step === "ways" ? "y yes · n no · esc cancel" : "enter next · esc " + (added || newDeck ? "done" : "cancel")}<//><//>
    <//>
  `;
}
