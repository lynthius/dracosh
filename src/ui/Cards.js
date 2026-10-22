import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { formatLine, parseLine, plainFront } from "../cardline.js";
import { fold } from "../judge.js";
import { TRASH_DAYS } from "../library.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 8; // rows of the list at a time

const look = (text) => fold(String(text).toLowerCase());
const lineOf = (card) => (card.cloze ? plainFront(card.front) : `${card.front} = ${card.back.join("; ")}`);
// a card matches what's typed in its front, any answer or its example, accents or not
const matches = (card, query) => !query || [card.front, ...card.back, card.example].some((text) => look(text).includes(look(query)));

// /cards: the cards of a deck, to search (type), fix, move to another deck or delete. A deleted card
// goes to the trash, and the row on top brings it straight back. `actions`: the library's;
// `onDeleted`(cardIds) → { entry }, `onRestored`(entry), `onEdited`(staleKeys) let the app keep the
// progress in step; `onAdd` opens /add for the deck; onClose(changed).
export function Cards({ deck, actions, onDeleted, onRestored, onEdited, onAdd, onClose }) {
  const panel = usePanelWidth();
  const [cards, setCards] = useState(null);
  const [decks, setDecks] = useState([]); // your other decks, to move a card to
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(null); // { card, step: "menu" | "edit" | "move" | "delete", selected }
  const [undo, setUndo] = useState(null); // { entry, card }: the card just deleted
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const changed = useRef(false);
  const busy = useRef(false);

  const load = () => actions.cardsIn(deck).then(setCards, (err) => setError(err.message));
  useEffect(() => {
    load();
    actions.ownDecks().then((own) => setDecks(own.filter((d) => d.name !== deck)), () => {});
  }, []);

  const found = (cards ?? []).filter((card) => matches(card, query));
  // the rows: bring back the card just deleted, add cards (with no search), then the cards found
  // (both only with no search: Enter on what's found never brings a card back by accident)
  const rows = [...(undo && !query ? [{ undo: true }] : []), ...(query ? [] : [{ add: true }]), ...found];

  async function run(work) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
    }
  }

  const pick = (row) => {
    setMessage("");
    if (row.undo) return restore();
    if (row.add) return onAdd();
    setOpen({ card: row, step: "menu", selected: 0 });
  };

  const restore = () =>
    run(async () => {
      await onRestored(undo.entry);
      setMessage(t("cards.restored", { card: cutToWidth(lineOf(undo.card), 40) }));
      setUndo(null);
      changed.current = true;
      await load();
    });

  const remove = (card) =>
    run(async () => {
      const { entry } = await onDeleted([card.id]);
      setOpen(null);
      setUndo({ entry, card });
      setQuery(""); // the whole list again, the way back on top
      setSelected(2); // on the cards, past the way back and + Add cards: a second Enter can't undo it
      setMessage(t("cards.deleted", { card: cutToWidth(lineOf(card), 40), days: TRASH_DAYS }));
      changed.current = true;
      await load();
    });

  const edit = (card, text) =>
    run(async () => {
      const fields = parseLine(text);
      if (!fields.front) throw new Error(t("add.needFront"));
      if (!fields.cloze && !fields.back.length) throw new Error(t("add.needBack"));
      const { staleKeys } = await actions.updateCardIn(deck, card.id, fields);
      await onEdited(staleKeys);
      setOpen(null);
      setMessage(t("add.fixed", { front: cutToWidth(plainFront(fields.front), 40) }));
      changed.current = true;
      await load();
    });

  const move = (card, to) =>
    run(async () => {
      const { moved } = await actions.moveCards(deck, [card.id], to);
      if (!moved.length) throw new Error(t("cards.alreadyThere", { deck: to }));
      setOpen(null);
      setMessage(t("cards.moved", { card: cutToWidth(lineOf(card), 40), deck: to }));
      changed.current = true;
      await load();
    });

  useInput((input, key) => {
    if (open) {
      if (key.leftArrow && open.step === "menu") setOpen(null);
      return;
    }
    if (key.escape) return query ? (setQuery(""), setSelected(0)) : onClose(changed.current);
    if (key.upArrow) return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSelected((i) => Math.min(rows.length - 1, i + 1));
    if (key.return) return rows[selected] && pick(rows[selected]);
    if (key.rightArrow) return rows[selected] && !rows[selected].add && !rows[selected].undo && pick(rows[selected]);
    if (key.backspace || key.delete) return query && (setQuery((q) => q.slice(0, -1)), setSelected(0));
    if (key.ctrl && input === "u") return setQuery("");
    const text = input.replace(/[\u0000-\u001f\u007f]/g, "");
    if (text && !key.ctrl && !key.meta) {
      setQuery((q) => q + text);
      setSelected(0);
      setMessage("");
    }
  });

  const frame = (title, body, hints, color = theme.accent) => html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${color} paddingX=${2} width=${panel}>
        <${Text} bold color=${color}>${title}<//>
        ${body}
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${hints} /><//>
    <//>
  `;

  if (open?.step === "edit")
    return frame(
      t("cards.editTitle", { deck }),
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text} dimColor>${t("cards.editHint")}<//>
          <${Box} marginTop=${1}><${AnswerInput} plain escLeaves cardLine initial=${formatLine(open.card)} onSubmit=${(text) => edit(open.card, text)} onExit=${() => setOpen((o) => ({ ...o, step: "menu" }))} onChange=${() => setError("")} /><//>
        <//>
      `,
      `${t("keyHints.tabPart")} · ${t("keyHints.addFixing")}`
    );

  if (open?.step === "move")
    return frame(
      t("cards.moveTitle", { card: cutToWidth(lineOf(open.card), 40) }),
      html`<${Box} marginTop=${1}>${decks.length ? html`<${Choice} options=${decks.map((d) => ({ label: d.name, note: t("count.cards", { count: d.cards }) }))} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => move(open.card, decks[i].name)} onCancel=${() => setOpen((o) => ({ ...o, step: "menu", selected: 1 }))} />` : html`<${Text}>${t("cards.noOtherDeck")}<//>`}<//>`,
      choiceHints("back")
    );

  if (open?.step === "delete")
    return frame(
      t("cards.deleteQuestion", { card: cutToWidth(lineOf(open.card), 50) }),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("cards.deleteNote", { days: TRASH_DAYS })}<//>
          <${Box} marginTop=${1}><${Choice} options=${[{ label: t("decks.deleteYes"), danger: true }, { label: t("cards.deleteNo") }]} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => (i === 0 ? remove(open.card) : setOpen((o) => ({ ...o, step: "menu", selected: 2 })))} onCancel=${() => setOpen((o) => ({ ...o, step: "menu", selected: 2 }))} /><//>
        <//>
      `,
      choiceHints("cancel"),
      theme.bad
    );

  if (open?.step === "menu") {
    const options = [{ label: t("cards.editRow") }, { label: t("cards.moveRow") }, { label: t("cards.deleteRow"), danger: true }];
    const steps = ["edit", "move", "delete"];
    return frame(
      cutToWidth(lineOf(open.card), panel - 8),
      html`
        <${Box} flexDirection="column">
          ${open.card.example && html`<${Text} dimColor italic>“${open.card.example}”<//>`}
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => setOpen((o) => ({ ...o, step: steps[i], selected: steps[i] === "delete" ? 1 : 0 }))} onCancel=${() => setOpen(null)} /><//>
        <//>
      `,
      t("keyHints.choiceLeft", { choose: t("choice.keys") })
    );
  }

  // the list, with the search on top
  const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), rows.length - SHOWN));
  const rowText = (row) => (row.undo ? t("cards.undoRow", { card: cutToWidth(lineOf(row.undo === true ? undo.card : row), 40) }) : row.add ? t("cards.addRow") : lineOf(row));
  return frame(
    t("cards.title", { deck, count: cards?.length ?? 0 }),
    html`
      <${Box} flexDirection="column">
        <${Box} marginTop=${1}>
          <${Box} flexShrink=${0}><${Text} dimColor>${t("languages.search")} <//><//>
          <${Text} wrap="truncate-start">${query}<//>
          <${Box} flexShrink=${0}><${Text} inverse> <//><//>
        <//>
        ${cards && query && !found.length && html`<${Text} dimColor wrap="truncate-end">${t("cards.noMatch", { query: cutToWidth(query, 20) })}<//>`}
        <${Text} dimColor>${top > 0 ? "  ↑" : " "}<//>
        ${rows.slice(top, top + SHOWN).map((row, i) => {
          const on = top + i === selected;
          return html`<${Text} key=${row.id ?? (row.undo ? "undo" : "add")} color=${on ? theme.accent : row.undo || row.add ? theme.good : undefined} bold=${on} wrap="truncate-end">${on ? "❯" : " "} ${rowText(row)}<//>`;
        })}
        <${Text} dimColor>${top + SHOWN < rows.length ? "  ↓" : " "}<//>
        ${query && found.length > 0 && html`<${Text} dimColor>${t("cards.found", { count: found.length })}<//>`}
      <//>
    `,
    t("keyHints.cards")
  );
}

// /cards while several decks are practised together: which deck's cards (`mix`: "all" or names)
export function CardsDeckPick({ actions, mix, current, onPick, onClose }) {
  const panel = usePanelWidth();
  const [decks, setDecks] = useState(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    actions.ownDecks().then((own) => {
      const list = mix === "all" ? own : own.filter((d) => mix.includes(d.name));
      setDecks(list);
      setSelected(Math.max(0, list.findIndex((d) => d.name === current)));
    }, () => setDecks([]));
  }, []);
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("cards.whichDeck")}<//>
        ${decks && html`<${Box} marginTop=${1}><${Choice} options=${decks.map((d) => ({ label: d.name, note: t("count.cards", { count: d.cards }) }))} selected=${selected} onMove=${setSelected} onPick=${(i) => onPick(decks[i].name)} onCancel=${onClose} /><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${choiceHints("back")} /><//>
    <//>
  `;
}
