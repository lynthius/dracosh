import { Fragment, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Choice, CHOICE_KEYS } from "./Choice.js";
import { html, PANEL_WIDTH, theme } from "./kit.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Reset from /settings: pick what to clear, see exactly what goes, then confirm (No is the default).
// A backup is made first, so `dracosh restore` can undo it.
export function Reset({ stats, actions, onConfirm, onClose }) {
  const [decks, setDecks] = useState(null);
  const [scope, setScope] = useState(0);
  const [answer, setAnswer] = useState(0);
  const [step, setStep] = useState("choose"); // choose | confirm | working
  const [error, setError] = useState("");

  useEffect(() => {
    actions.allDecks().then(setDecks, (err) => setError(err.message));
  }, []);

  const own = (decks ?? []).filter((d) => !d.tour);
  const cards = own.reduce((sum, d) => sum + d.cards, 0);
  const badges = stats.badges.filter((b) => b.unlockedOn).length;
  const progress = [plural(badges, "badge"), stats.streak.best > 0 && `a ${stats.streak.best}-day best streak`, `your ${stats.companion.name}`].filter(Boolean).join(" · ");
  const SCOPES = [
    { scope: "progress", label: "Progress", note: "badges, streak and the dragon start over; your cards stay", question: "Reset your progress?", goes: progress, stays: "Your decks, cards and how well you know them stay." },
    { scope: "everything", label: "Everything", note: "a fresh start with the tour; settings stay", question: "Reset everything?", goes: `${plural(own.length, "deck")} · ${plural(cards, "card")} · ${progress}`, stays: "Dracosh starts over like a fresh install, with the tour. Settings stay." }
  ];
  const chosen = SCOPES[scope];

  async function confirm(index) {
    if (index === 0) return setStep("choose");
    setStep("working");
    try {
      await onConfirm(chosen.scope);
    } catch (err) {
      setError(err.message);
      setStep("confirm");
    }
  }

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${step === "choose" ? theme.accent : theme.bad} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} bold color=${step === "choose" ? theme.accent : theme.bad}>${step === "choose" ? "Reset: what should start over?" : chosen.question}<//>
        ${step === "choose" &&
        html`<${Box} marginTop=${1}><${Choice} options=${SCOPES} selected=${scope} onMove=${setScope} onPick=${(i) => decks && (setScope(i), setAnswer(0), setStep("confirm"))} onCancel=${onClose} /><//>`}
        ${step !== "choose" &&
        html`
          <${Box} flexDirection="column">
            <${Box} flexDirection="column" marginTop=${1}>
              <${Text}>This clears <${Text} bold>${chosen.goes}<//>.<//>
              <${Text} dimColor>${chosen.stays} A backup is made first, so dracosh restore can undo it.<//>
            <//>
            <${Box} marginTop=${1}>
              <${Choice}
                options=${[{ label: "No, keep it all", key: "n" }, { label: `Yes, reset ${chosen.label.toLowerCase()}`, key: "y", danger: true }]}
                selected=${answer}
                onMove=${setAnswer}
                onPick=${(i) => step === "confirm" && confirm(i)}
                onCancel=${() => setStep("choose")}
              />
            <//>
          <//>
        `}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>${step === "working" ? "resetting…" : `${CHOICE_KEYS} · esc back`}<//><//>
    <//>
  `;
}
