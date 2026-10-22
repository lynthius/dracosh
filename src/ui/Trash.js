import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { dayKey } from "../dates.js";
import { TRASH_DAYS } from "../library.js";
import { formatDay } from "../vacation.js";
import { Choice } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";
import { plainFront } from "../cardline.js";

// a deleted deck by its name, a card as "front = back", several cards by how many
const labelOf = (entry) => (entry.kind !== "cards" ? entry.name : entry.card ? cutToWidth(entry.card.cloze ? plainFront(entry.card.front) : `${entry.card.front} = ${entry.card.back.join("; ")}`, 34) : t("count.cards", { count: entry.cards }));
// /trash: decks and cards deleted in the last TRASH_DAYS, newest first; Enter brings one back with its
// progress (`onRestore`(id) → { deck, kind, cards, skipped }): a deck whole, cards into their deck.
export function Trash({ actions, onRestore, onClose }) {
  const panel = usePanelWidth();
  const [entries, setEntries] = useState(null);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);

  const load = () => actions.trash().then(setEntries, (err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  useInput((input, key) => {
    if (entries && !entries.length && (key.escape || key.return || input === "q")) onClose();
  });

  async function restore(i) {
    if (busy.current) return;
    busy.current = true;
    try {
      const back = await onRestore(entries[i].id);
      setMessage(back.kind === "cards" ? t("trash.cardsRestored", { count: back.cards, deck: back.deck }) + (back.skipped ? ` ${t("trash.skipped", { count: back.skipped })}` : "") : t("trash.restored", { deck: back.deck }));
      await load();
      setSelected((s) => Math.max(0, Math.min(s, entries.length - 2)));
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
    }
  }

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("trash.title")}<//>
        <${Text} dimColor>${t("trash.note", { days: TRASH_DAYS })}<//>
        <${Box} marginTop=${1}>
          ${entries?.length
            ? html`<${Choice} options=${entries.map((entry) => ({ label: labelOf(entry), note: t(entry.kind === "cards" ? "trash.cardsRow" : "trash.row", { cards: t("count.cards", { count: entry.cards }), deck: entry.name, deleted: formatDay(dayKey(entry.deletedAt)), until: formatDay(dayKey(entry.until)) }) }))} selected=${Math.min(selected, entries.length - 1)} onMove=${setSelected} onPick=${restore} onCancel=${onClose} />`
            : entries && html`<${Text}>${t("trash.empty")}<//>`}
        <//>
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${entries?.length ? t("keyHints.trash") : t("keyHints.back")} /><//>
    <//>
  `;
}
