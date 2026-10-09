import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, PANEL_WIDTH, theme } from "./kit.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Reset from /settings: pick what to clear, see exactly what goes, then confirm with "y".
// A backup is made first, so `dracosh restore` can undo it.
export function Reset({ stats, actions, onConfirm, onClose }) {
  const [decks, setDecks] = useState(null);
  const [picked, setPicked] = useState(0);
  const [step, setStep] = useState("choose"); // choose | confirm | working
  const [error, setError] = useState("");

  useEffect(() => {
    actions.allDecks().then(setDecks, (err) => setError(err.message));
  }, []);

  const own = (decks ?? []).filter((d) => !d.tour);
  const cards = own.reduce((sum, d) => sum + d.cards, 0);
  const badges = stats.badges.filter((b) => b.unlockedOn).length;
  const progress = [plural(badges, "badge"), stats.streak.best > 0 && `a ${stats.streak.best}-day best streak`, `your ${stats.companion.name}`].filter(Boolean).join(" · ");
  const OPTIONS = [
    { scope: "progress", label: "Progress", goes: progress, stays: "Your decks, cards and how well you know them stay." },
    { scope: "everything", label: "Everything", goes: `${plural(own.length, "deck")} · ${plural(cards, "card")} · ${progress}`, stays: "Dracosh starts over like a fresh install, with the tour. Settings stay." }
  ];
  const option = OPTIONS[picked];

  async function confirm() {
    setStep("working");
    try {
      await onConfirm(option.scope);
    } catch (err) {
      setError(err.message);
      setStep("confirm");
    }
  }

  useInput((input, key) => {
    if (step === "working") return;
    if (key.escape || input === "n" || input === "q") return step === "confirm" ? setStep("choose") : onClose();
    if (step === "choose") {
      if (key.upArrow) setPicked(0);
      if (key.downArrow) setPicked(1);
      if (key.return && decks) setStep("confirm");
    } else if (input === "y") confirm();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.bad} paddingX=${2} width=${PANEL_WIDTH}>
        <${Text} bold color=${theme.bad}>Reset<//>
        ${step === "choose" &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            ${OPTIONS.map(
              (o, i) => html`
                <${Text} key=${o.scope} color=${i === picked ? theme.accent : undefined} bold=${i === picked}>${i === picked ? "❯" : " "} ${o.label}<//>
              `
            )}
          <//>
        `}
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text}>${step === "choose" ? "Clears" : `Reset ${option.label.toLowerCase()}? This clears`}: <${Text} bold>${option.goes}<//><//>
          <${Text} dimColor>${option.stays}<//>
        <//>
        ${step !== "choose" && html`<${Box} marginTop=${1}><${Text}>A backup is made first, so ${html`<${Text} bold>dracosh restore<//>`} can undo it.<//><//>`}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>${step === "choose" ? "↑/↓ choose · enter next · esc back" : step === "confirm" ? "y reset · n back" : "resetting…"}<//><//>
    <//>
  `;
}
