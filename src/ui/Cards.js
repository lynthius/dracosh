import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { language, t } from "../i18n.js";
import { providerName } from "../ai.js";
import { checkCard } from "../assist.js";
import { formatLine, parseLine, plainFront } from "../cardline.js";
import { fold } from "../judge.js";
import { TRASH_DAYS } from "../library.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 8; // rows of the list at a time
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// a card's menu: checked first for a card written by AI help; a check by AI when it's set up
const menuOf = (card, ai) => [...(card.ai ? ["confirm"] : []), ...(ai && !card.cloze ? ["check"] : []), "edit", "move", "delete"];

const look = (text) => fold(String(text).toLowerCase());
const lineOf = (card) => (card.cloze ? plainFront(card.front) : `${card.front} = ${card.back.join("; ")}`);
// a card matches what's typed in its front, any answer or its example, accents or not
const matches = (card, query) => !query || [card.front, ...card.back, card.example].some((text) => look(text).includes(look(query)));

// /cards: the cards of a deck, to search (type), fix, move to another deck or delete. A deleted card
// goes to the trash, and the row on top brings it straight back. `actions`: the library's;
// `onDeleted`(cardIds) → { entry }, `onRestored`(entry), `onEdited`(staleKeys) let the app keep the
// progress in step; `onAdd` opens /add for the deck; onClose(changed).
export function Cards({ deck, actions, onDeleted, onRestored, onEdited, onAdd, onClose, ai = null }) {
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
  const checking = useRef(null); // the check by AI in flight: its AbortController
  const [spin, setSpin] = useState(0);
  const menuAt = (card, step) => menuOf(card, ai).indexOf(step);
  const waiting = open?.step === "check" && !open.verdict;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setSpin((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => () => checking.current?.abort(), []);

  const load = () => actions.cardsIn(deck).then(setCards, (err) => setError(err.message));
  useEffect(() => {
    load();
    actions.ownDecks().then((own) => setDecks(own.filter((d) => d.name !== deck)), () => {});
  }, []);

  // the cards AI wrote and you haven't checked come first, in their own order
  const found = (cards ?? []).filter((card) => matches(card, query)).sort((a, b) => Number(Boolean(b.ai)) - Number(Boolean(a.ai)));
  const toCheck = (cards ?? []).filter((card) => card.ai).length;
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
      // Enter on the card as it was keeps it marked as AI's: only a change or "It's right" checks it
      const { staleKeys } = await actions.updateCardIn(deck, card.id, { ...fields, ai: card.ai && formatLine(fields) === formatLine(card) });
      await onEdited(staleKeys);
      setOpen(null);
      setMessage(t("add.fixed", { front: cutToWidth(plainFront(fields.front), 40) }));
      changed.current = true;
      await load();
    });

  const confirm = (card) =>
    run(async () => {
      await actions.confirmCardIn(deck, card.id);
      setOpen(null);
      setMessage(t("cards.confirmed", { card: cutToWidth(lineOf(card), 40) }));
      changed.current = true;
      await load();
    });

  // AI looks the card over: nothing wrong, or what is, with a fix to take or leave. One check at a time,
  // and an answer that comes after Esc (or after the menu was left) changes nothing.
  async function check(card) {
    if (checking.current) return;
    const controller = new AbortController();
    checking.current = controller;
    setError("");
    setOpen((o) => ({ ...o, step: "check", verdict: null, selected: 0 }));
    const name = providerName(ai.provider);
    try {
      const [languages, all] = await Promise.all([actions.languagesOf(deck).catch(() => ({})), actions.cardsIn(deck).catch(() => [])]);
      const verdict = await checkCard(ai, { card, languages, cards: all, language: language(), signal: controller.signal });
      if (controller.signal.aborted) return;
      const still = (o) => o?.step === "check" && !o.verdict && o.card.id === card.id;
      if (!verdict.ok) return setOpen((o) => (still(o) ? { ...o, verdict } : o));
      // an AI card keeps its ✦: AI saying it's right isn't you checking it
      setOpen((o) => (still(o) ? null : o));
      setMessage(t("cards.checkOk", { provider: name, card: cutToWidth(lineOf(card), 40) }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setOpen((o) => (o?.step === "check" && !o.verdict ? { ...o, step: "menu", selected: menuAt(o.card, "check") } : o));
      setError(err.code === "unreadable" ? t("cards.checkUnclear", { provider: name }) : err.message);
    } finally {
      if (checking.current === controller) checking.current = null;
    }
  }

  const useFix = (card, fix) =>
    run(async () => {
      const { staleKeys } = await actions.updateCardIn(deck, card.id, fix);
      await onEdited(staleKeys);
      setOpen(null);
      setMessage(t("add.fixed", { front: cutToWidth(plainFront(fix.front), 40) }));
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
    if (open?.step === "check" && !open.verdict) {
      if (key.escape || key.leftArrow) {
        checking.current?.abort();
        checking.current = null;
        setOpen((o) => ({ ...o, step: "menu", selected: menuAt(o.card, "check") }));
      }
      return;
    }
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
          <${Box} marginTop=${1}><${AnswerInput} plain escLeaves cardLine initial=${formatLine(open.card)} onSubmit=${(text) => edit(open.card, text)} onExit=${() => setOpen((o) => ({ ...o, step: "menu", selected: menuAt(o.card, "edit") }))} onChange=${() => setError("")} /><//>
        <//>
      `,
      `${t("keyHints.tabPart")} · ${t("keyHints.addFixing")}`
    );

  if (open?.step === "move")
    return frame(
      t("cards.moveTitle", { card: cutToWidth(lineOf(open.card), 40) }),
      html`<${Box} marginTop=${1}>${decks.length ? html`<${Choice} options=${decks.map((d) => ({ label: d.name, note: t("count.cards", { count: d.cards }) }))} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => move(open.card, decks[i].name)} onCancel=${() => setOpen((o) => ({ ...o, step: "menu", selected: menuAt(o.card, "move") }))} />` : html`<${Text}>${t("cards.noOtherDeck")}<//>`}<//>`,
      choiceHints("back")
    );

  if (open?.step === "delete")
    return frame(
      t("cards.deleteQuestion", { card: cutToWidth(lineOf(open.card), 50) }),
      html`
        <${Box} flexDirection="column">
          <${Text} dimColor>${t("cards.deleteNote", { days: TRASH_DAYS })}<//>
          <${Box} marginTop=${1}><${Choice} options=${[{ label: t("decks.deleteYes"), danger: true }, { label: t("cards.deleteNo") }]} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => (i === 0 ? remove(open.card) : setOpen((o) => ({ ...o, step: "menu", selected: menuAt(o.card, "delete") })))} onCancel=${() => setOpen((o) => ({ ...o, step: "menu", selected: menuAt(o.card, "delete") }))} /><//>
        <//>
      `,
      choiceHints("cancel"),
      theme.bad
    );

  if (open?.step === "check") {
    const name = providerName(ai.provider);
    const { verdict } = open;
    const back = () => setOpen((o) => ({ ...o, step: "menu", verdict: null, selected: menuAt(o.card, "check") }));
    return frame(
      cutToWidth(lineOf(open.card), panel - 8),
      verdict
        ? html`
            <${Box} flexDirection="column">
              ${open.card.example && html`<${Text} dimColor italic>“${open.card.example}”<//>`}
              <${Box} marginTop=${1}><${Box} flexShrink=${0}><${Text} color=${theme.accent}>✦ <//><//><${Text} color=${theme.accent}>${verdict.note || t("cards.checkFix", { provider: name })}<//><//>
              <${Box} marginTop=${1} flexDirection="column" paddingLeft=${2}>
                ${verdict.fix && html`<${Fixed} card=${open.card} fix=${verdict.fix} />`}
              <//>
              <${Box} marginTop=${1}><${Choice} options=${verdict.fix ? [{ label: t("cards.useFix") }, { label: t("cards.keepMine") }] : [{ label: t("cards.keepMine") }]} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => (verdict.fix && i === 0 ? useFix(open.card, verdict.fix) : back())} onCancel=${back} /><//>
            <//>
          `
        : html`
            <${Box} flexDirection="column">
              ${open.card.example && html`<${Text} dimColor italic>“${open.card.example}”<//>`}
              <${Box} marginTop=${1}><${Text} color=${theme.accent}>${SPIN[spin % SPIN.length]} ${t("cards.checking", { provider: name })}<//><//>
            <//>
          `,
      verdict ? choiceHints("back") : t("keyHints.aiWaiting")
    );
  }

  if (open?.step === "menu") {
    const steps = menuOf(open.card, ai);
    const labels = { confirm: t("cards.confirmRow"), check: t("cards.checkRow"), edit: t("cards.editRow"), move: t("cards.moveRow"), delete: t("cards.deleteRow") };
    const options = steps.map((step) => ({ label: labels[step], danger: step === "delete" }));
    return frame(
      cutToWidth(lineOf(open.card), panel - 8),
      html`
        <${Box} flexDirection="column">
          ${open.card.example && html`<${Text} dimColor italic>“${open.card.example}”<//>`}
          ${open.card.ai && html`<${Box} marginTop=${1}><${Text} color=${theme.accent}>${t("cards.aiNote")}<//><//>`}
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${open.selected} onMove=${(i) => setOpen((o) => ({ ...o, selected: i }))} onPick=${(i) => (steps[i] === "confirm" ? confirm(open.card) : steps[i] === "check" ? check(open.card) : setOpen((o) => ({ ...o, step: steps[i], selected: steps[i] === "delete" ? 1 : 0 })))} onCancel=${() => setOpen(null)} /><//>
        <//>
      `,
      t("keyHints.choiceLeft", { choose: t("choice.keys") })
    );
  }

  // the list, with the search on top
  const top = Math.max(0, Math.min(selected - Math.floor(SHOWN / 2), rows.length - SHOWN));
  const gutter = (cards ?? []).some((card) => card.ai); // room for a ✦ before every card, so they line up
  const rowText = (row) => (row.undo ? t("cards.undoRow", { card: cutToWidth(lineOf(row.undo === true ? undo.card : row), 40) }) : row.add ? t("cards.addRow") : lineOf(row));
  return frame(
    html`<${Fragment}>${t("cards.title", { deck, count: cards?.length ?? 0 })}${toCheck > 0 ? html`<${Text} bold=${false}>  ${t("cards.toCheck", { count: toCheck })}<//>` : ""}<//>`,
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
          return html`<${Text} key=${row.id ?? (row.undo ? "undo" : "add")} color=${on ? theme.accent : row.undo || row.add ? theme.good : undefined} bold=${on} wrap="truncate-end">${on ? "❯" : " "} ${row.ai ? html`<${Text} color=${theme.accent}>✦ <//>` : gutter && row.id ? "  " : ""}${rowText(row)}<//>`;
        })}
        <${Text} dimColor>${top + SHOWN < rows.length ? "  ↓" : " "}<//>
        ${query && found.length > 0 && html`<${Text} dimColor>${t("cards.found", { count: found.length })}<//>`}
      <//>
    `,
    t("keyHints.cards")
  );
}

// the card as AI would fix it, what it changes in the accent colour
function Fixed({ card, fix }) {
  const changed = (on) => (on ? theme.accent : undefined);
  const parts = fix.back.map((answer, i) => html`<${Text} key=${i} color=${changed(!card.back.includes(answer))}>${i ? "; " : ""}${answer}<//>`);
  return html`
    <${Box} flexDirection="column">
      <${Text} bold wrap="truncate-end"><${Text} color=${changed(fix.front !== card.front)}>${fix.front}<//> = ${parts}<//>
      ${fix.example && html`<${Text} italic color=${changed(fix.example !== (card.example ?? ""))} dimColor=${fix.example === (card.example ?? "")}>“${fix.example}”<//>`}
    <//>
  `;
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
