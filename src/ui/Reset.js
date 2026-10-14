import { Fragment, useEffect, useState } from "react";
import { Box } from "ink";
import { t } from "../i18n.js";
import { Choice, choiceHints } from "./Choice.js";
import { html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";


// Reset from /settings: pick what to clear, see exactly what goes, then confirm (No is the default).
// A backup is made first, so `dracosh restore` can undo it.
export function Reset({ stats, actions, onConfirm, onClose }) {
  const panel = usePanelWidth();
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
  const progress = [t("count.badges", { count: badges }), stats.streak.best > 0 && t("reset.bestStreak", { count: stats.streak.best }), t("reset.yourDragon", { name: stats.companion.name })].filter(Boolean).join(" · ");
  const everything = [t("count.decks", { count: own.length }), t("count.cards", { count: cards }), progress].join(" · ");
  const option = (name, goes) => ({ scope: name, goes, ...Object.fromEntries(["label", "note", "question", "stays", "yes"].map((key) => [key, t(`reset.${name}.${key}`)])) });
  const SCOPES = [option("progress", progress), option("everything", everything)];
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
      <${Box} flexDirection="column" borderStyle="round" borderColor=${step === "choose" ? theme.accent : theme.bad} paddingX=${2} width=${panel}>
        <${Text} bold color=${step === "choose" ? theme.accent : theme.bad}>${step === "choose" ? t("reset.pickTitle") : chosen.question}<//>
        ${step === "choose" &&
        html`<${Box} marginTop=${1}><${Choice} options=${SCOPES} selected=${scope} onMove=${setScope} onPick=${(i) => decks && (setScope(i), setAnswer(0), setStep("confirm"))} onCancel=${onClose} /><//>`}
        ${step !== "choose" &&
        html`
          <${Box} flexDirection="column">
            <${Box} flexDirection="column" marginTop=${1}>
              <${Text}>${t("reset.clears", { what: chosen.goes })}<//>
              <${Text} dimColor>${chosen.stays} ${t("reset.backupFirst")}<//>
            <//>
            <${Box} marginTop=${1}>
              <${Choice}
                options=${[{ label: t("reset.no"), key: t("choice.noKey") }, { label: chosen.yes, key: t("choice.yesKey"), danger: true }]}
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
      <${Box} paddingX=${1}><${KeyHints} text=${step === "working" ? t("keyHints.resetting") : choiceHints()} /><//>
    <//>
  `;
}
