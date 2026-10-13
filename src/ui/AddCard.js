import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { MAX_DECK_NAME, typedSides } from "../library.js";
import { blankGap, formatLine, gapsOf, parseBack, parseLine, plainFront } from "../cardline.js";
import { normalize } from "../judge.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { t } from "../i18n.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN_CARDS = 5; // the cards added so far, newest last
const PASTE_ROWS = 8; // rows of a pasted list on screen at once
const answers = (back) => back.join(" / ");

// How a card will be asked in a deck, for the line under the field: "kot → ?  you type cat / kitty"
function askedAs(fields, directions) {
  if (fields.cloze) return t("add.preview.cloze", { prompt: blankGap(fields.front, 0) + (fields.back.length ? ` (${answers(fields.back)})` : ""), count: gapsOf(fields.front).length });
  const [front, back] = [fields.front, answers(fields.back)];
  if (!directions) return t("add.preview.pair", { front, back });
  if (directions === "backward") return t("add.preview.asks", { prompt: back, answer: front });
  const forward = t("add.preview.asks", { prompt: front, answer: back });
  return directions === "both" ? t("add.preview.both", { forward, backward: t("add.preview.asks", { prompt: back, answer: front }) }) : forward;
}

// what would have to be typed in the quiz starts with "/", which opens the commands there
function startsWithSlash(fields, directions) {
  const slash = (text) => text.startsWith("/");
  if (fields.cloze) return gapsOf(fields.front).some(slash);
  return typedSides({ directions: directions ?? "forward" }).some((side) => [fields[side]].flat().some(slash));
}

// A pasted list, one card per line: a tab splits the lines when every one of them has one (Anki and
// Quizlet exports), " = " otherwise. Lines that can't be added as they are say why.
// A list written with dashes ("apple - jabłko") is taken as it is when most lines have one and none
// has " = "; each line splits on a tab, or on its first dash
const DASHES = [" - ", " – ", " — "];
function separatorFor(lines) {
  const dashed = !lines.some((line) => line.includes(" = ")) && lines.filter((line) => DASHES.some((dash) => line.includes(dash))).length * 2 >= lines.length;
  return (line) => (line.includes("\t") ? "\t" : dashed ? (DASHES.map((dash) => [dash, line.indexOf(dash)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] ?? " = ") : " = ");
}

function readPaste(lines, existing, directions) {
  const separatorOf = separatorFor(lines);
  return lines.map((line) => {
    const separator = separatorOf(line);
    const fields = parseLine(line, { separator });
    const issue = issueOf(fields, directions, existing.has(normalize(fields.front)));
    return { line: separator === " = " ? line.trim() : formatLine(fields), fields, issue, dropped: false };
  });
}

const issueOf = (fields, directions, inDeck) =>
  !fields.front ? "noFront" : !fields.cloze && !fields.back.length ? "noBack" : startsWithSlash(fields, directions) ? "slash" : inDeck ? "inDeck" : null;

// A line repeating an earlier one (kept, not dropped) waits; drop or fix either and the other is free
function withRepeats(items) {
  const seen = new Set();
  return items.map((item) => {
    if (item.dropped || item.issue) return item;
    const key = normalize(item.fields.front);
    if (seen.has(key)) return { ...item, issue: "twice" };
    seen.add(key);
    return item;
  });
}

// /add: a small form inside the app. You pick one of your decks or start a new one (your first one
// replaces the tour), then add cards one line each until Esc: "kot = cat; kitty // example". After a new
// deck's first card it asks which way the deck is asked. A pasted list opens a review first.
// `actions` reads and writes the library; `startNew` skips the deck list ("+ New deck" in /decks).
export function AddCard({ current, actions, onDone, startNew = false }) {
  const panel = usePanelWidth();
  const [step, setStep] = useState("loading"); // loading | pick | deck | line | back | direction | review | fix | saving
  const [decks, setDecks] = useState([]);
  const [picked, setPicked] = useState(0);
  const [deck, setDeck] = useState(null); // { name, directions, isNew }: isNew until its direction is picked
  const [newDeck, setNewDeck] = useState(null); // { name, removed } once a deck was started here
  const [added, setAdded] = useState([]); // cards added (or fixed) in this /add, oldest first
  const stale = useRef([]); // progress keys of fixed cards that no longer exist
  const [draft, setDraft] = useState(null); // a front waiting for its back (a line without " = ")
  const [editing, setEditing] = useState(null); // the added card being fixed (↑)
  const [field, setField] = useState({ key: 0, initial: "" }); // a new key clears the field
  const [typed, setTyped] = useState(""); // what's in the field, for the preview
  const [duplicate, setDuplicate] = useState(null);
  const [direction, setDirection] = useState(0);
  const [sample, setSample] = useState(null); // the card the direction question shows
  const busy = useRef(false); // a save in flight: Enter again does nothing
  const [pasted, setPasted] = useState(null); // { items, selected, confirm, fixing }
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lookup = useRef(0);

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

  // `dropped`: a card was half written (its front typed, or a paste not added) when /add ended
  const finish = () => onDone({ deck: newDeck?.name ?? null, removed: newDeck?.removed ?? [], stale: stale.current, added: added.length, dropped: Boolean(draft || pasted) });

  const clearField = (initial = "") => {
    setField((f) => ({ key: f.key + 1, initial }));
    setTyped(initial);
    setDuplicate(null);
  };

  // the field changed: the preview follows, and a front already in the deck is flagged as you type
  function onType(value) {
    setTyped(value);
    setError("");
    if (step !== "line") return;
    const { front } = parseLine(value);
    const ask = ++lookup.current;
    if (!front) return setDuplicate(null);
    actions.existingCard(deck.name, front).then((card) => ask === lookup.current && setDuplicate(card && card.id !== editing?.id ? card : null), () => {});
  }

  async function startDeck(name) {
    if (busy.current) return;
    busy.current = true;
    try {
      const { deck: created, removed } = await actions.startDeck({ name });
      setDeck({ name: created.name, directions: created.directions, isNew: true });
      setNewDeck({ name: created.name, removed });
      setMessage(t("add.deckReady", { deck: created.name }));
      clearField();
      setStep("line");
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
    }
  }

  // after a new deck's first card (or first pasted cards): which way it's asked
  const afterSave = (card) => {
    clearField();
    if (deck.isNew && !card.cloze) {
      setDirection(0);
      setSample(card);
      return setStep("direction");
    }
    setStep("line");
  };

  async function save(fields) {
    if (busy.current) return;
    busy.current = true;
    try {
      if (editing) {
        const { card, staleKeys } = await actions.updateCardIn(deck.name, editing.id, fields);
        stale.current.push(...staleKeys);
        setAdded((list) => list.map((c) => (c.id === card.id ? { ...card, fixed: true } : c)));
        setMessage(t("add.fixed", { front: plainFront(card.front) }));
        setEditing(null);
        setDraft(null);
        clearField();
        return setStep("line");
      }
      const { card, duplicate: existing } = await actions.addCardTo(deck.name, fields);
      if (existing) return setError(t("add.duplicateCard", { front: existing.front, deck: deck.name }));
      setDraft(null);
      setAdded((list) => [...list, card]);
      setMessage("");
      afterSave(card);
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
    }
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
        startDeck(value);
      }, (err) => setError(err.message));
    }
    if (step === "line") {
      if (!value) return setError(t("add.needFront"));
      const fields = parseLine(value);
      if (!fields.front) return setError(t("add.needFront"));
      if (duplicate) return; // the warning is already under the field
      if (!fields.cloze && !fields.hasBack) {
        setDraft(fields);
        clearField();
        return setStep("back");
      }
      if (!fields.cloze && !fields.back.length) return setError(t("add.needBack"));
      return save(fields);
    }
    if (step === "back") {
      const { back, example } = parseBack(value);
      if (!back.length) return setError(t("add.needBack"));
      return save({ ...draft, back, example: example || draft.example });
    }
    if (step === "fix") {
      const fields = parseLine(value);
      return actions
        .existingCard(deck.name, fields.front)
        .catch(() => null)
        .then((existing) => {
          setPasted((p) => {
            const issue = issueOf(fields, deck.isNew ? null : deck.directions, Boolean(existing));
            return { ...p, items: p.items.map((item, i) => (i === p.selected ? { line: value, fields, issue, dropped: false } : item)), confirm: false };
          });
          setStep("review");
        });
    }
  }

  // Esc on an empty field: one step back at a time, and out of /add from the plain card line
  function back() {
    setError("");
    if (step === "back") {
      clearField(formatLine(draft));
      setDraft(null);
      return setStep("line");
    }
    if (step === "fix") return setStep("review");
    if (step === "deck" && decks.length && !startNew) return setStep("pick");
    if (step === "line" && editing) {
      setEditing(null);
      setMessage("");
      return clearField();
    }
    finish();
  }

  // ↑ on an empty line: the last card comes back into the field, and Enter saves it fixed
  function recall() {
    const last = added.at(-1);
    if (!last || step !== "line") return;
    setEditing(last);
    setMessage(t("add.fixing", { front: plainFront(last.front) }));
    clearField(formatLine(last));
  }

  function pickDeck(index) {
    if (index === decks.length) return setStep("deck");
    setDeck({ name: decks[index].name, directions: decks[index].directions, isNew: false });
    clearField();
    setStep("line");
  }

  // Keys that aren't an answer to the question (the next card, typed straight away) keep the first
  // choice and go into the field, so nothing typed is lost
  const typedAhead = useRef("");
  const picking = useRef(false);
  async function pickDirection(index) {
    if (picking.current) return;
    picking.current = true;
    const chosen = ["forward", "backward", "both"][index];
    try {
      await actions.setDirections(deck.name, chosen);
      setDeck((d) => ({ ...d, directions: chosen, isNew: false }));
      setMessage(t("add.directionSet", { how: askedAs(sample, chosen) }));
    } catch (err) {
      setError(err.message);
    }
    clearField(typedAhead.current);
    typedAhead.current = "";
    picking.current = false;
    setStep("line");
  }

  // a pasted list: each line checked against the deck before anything is saved
  async function openPaste(lines) {
    const separatorOf = separatorFor(lines);
    const fronts = await Promise.all(lines.map((line) => actions.existingCard(deck.name, parseLine(line, { separator: separatorOf(line) }).front).catch(() => null)));
    const existing = new Set(fronts.filter(Boolean).map((card) => normalize(card.front)));
    setPasted({ items: readPaste(lines, existing, deck.isNew ? null : deck.directions), selected: 0, confirm: false, total: lines.length });
    setError("");
    setMessage("");
    setStep("review");
  }

  async function addPasted() {
    const ready = withRepeats(pasted.items).filter((item) => !item.dropped && !item.issue);
    if (!ready.length) return setError(t("add.paste.nothing"));
    setStep("saving");
    try {
      const { added: cards } = await actions.addCardsTo(deck.name, ready.map((item) => item.fields));
      setAdded((list) => [...list, ...cards]);
      setPasted(null);
      const skipped = pasted.items.length - ready.length - pasted.items.filter((item) => item.dropped).length;
      setMessage([t("add.paste.added", { count: cards.length, deck: deck.name }), skipped > 0 && t("add.paste.skipped", { count: skipped })].filter(Boolean).join(" "));
      if (cards.length) return afterSave(cards.find((card) => !card.cloze) ?? cards[0]);
      setStep("line");
    } catch (err) {
      setError(err.message);
      setStep("review");
    }
  }

  useInput(
    (input, key) => {
      if (picking.current ? input && !key.return : input && !/^[1-3]$/.test(input) && !key.ctrl && !key.meta && !key.return && !key.escape && !key.tab) {
        typedAhead.current += input;
        pickDirection(0);
      }
    },
    { isActive: step === "direction" }
  );

  useInput(
    (input, key) => {
      if (key.escape) {
        if (pasted.confirm) {
          setPasted(null);
          setError("");
          return setStep("line");
        }
        return setPasted((p) => ({ ...p, confirm: true }));
      }
      if (pasted.confirm) setPasted((p) => ({ ...p, confirm: false }));
      if (key.upArrow) return setPasted((p) => ({ ...p, selected: Math.max(0, p.selected - 1) }));
      if (key.downArrow) return setPasted((p) => ({ ...p, selected: Math.min(p.items.length - 1, p.selected + 1) }));
      if (input === "x") return setPasted((p) => ({ ...p, items: p.items.map((item, i) => (i === p.selected ? { ...item, dropped: !item.dropped } : item)) }));
      if (input === "e") {
        clearField(pasted.items[pasted.selected].line);
        return setStep("fix");
      }
      if (key.return) addPasted();
    },
    { isActive: step === "review" }
  );

  const title =
    step === "pick" ? t("add.titlePick") : step === "deck" ? t(decks.length ? "add.titleNew" : "add.titleFirst") : step === "review" || step === "fix" ? t("add.paste.title", { deck: deck.name }) : t("add.titleCard", { deck: deck?.name ?? "" });
  const fieldLabel = step === "deck" ? "deck" : step === "back" ? "back" : step === "line" || step === "fix" ? "line" : null;
  const parsed = step === "line" && typed.trim() ? parseLine(typed) : null;
  const preview = !parsed ? null : parsed.cloze || parsed.back.length ? askedAs(parsed, deck.isNew ? null : deck.directions) : parsed.hasBack ? null : t("add.preview.noBack");
  const shownPaste = pasted ? withRepeats(pasted.items) : [];
  const ready = shownPaste.filter((item) => !item.dropped && !item.issue).length;
  const narrow = panel < 60;
  const firstRow = pasted ? Math.max(0, Math.min(pasted.selected - Math.floor(PASTE_ROWS / 2), pasted.items.length - PASTE_ROWS)) : 0;
  const label = (text) => cutToWidth(text, Math.max(12, Math.floor(panel / 2) - 8)); // a long front or definition shortened in the list

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${title}<//>
        ${added.length > 0 && (step === "line" || step === "back" || step === "direction" || step === "saving") &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            ${added.length > SHOWN_CARDS && html`<${Text} dimColor>${t("add.more", { count: added.length - SHOWN_CARDS })}<//>`}
            ${added.slice(-SHOWN_CARDS).map((card) => html`<${Text} key=${card.id} dimColor wrap="truncate-end"><${Text} color=${theme.good}>${card.fixed ? "✎" : "✓"}<//> ${card.cloze ? plainFront(card.front) : `${card.front} = ${answers(card.back)}`}<//>`)}
          <//>
        `}
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${step === "back" && draft && html`<${Box} marginTop=${1}><${Text} dimColor>${draft.front}  =<//><//>`}
        ${fieldLabel &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} bold>${t(`add.fields.${fieldLabel}.label`)}<//>
            <${Text} dimColor>${t(`add.fields.${fieldLabel}.hint`)}<//>
            <${Box} marginTop=${1}>
              <${AnswerInput}
                key=${`${fieldLabel}-${field.key}`}
                plain
                initial=${field.initial}
                onSubmit=${submit}
                onExit=${back}
                onChange=${onType}
                onRecall=${step === "line" ? recall : undefined}
                onPaste=${step === "line" ? openPaste : undefined}
              />
            <//>
            ${preview && html`<${Box} paddingLeft=${2}><${Text} dimColor>${preview}<//><//>`}
            ${duplicate && step === "line" && html`<${Box} paddingLeft=${2}><${Text} color=${theme.warn}>${t("add.duplicateCard", { front: duplicate.front, deck: deck.name })}<//><//>`}
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
        ${step === "direction" &&
        sample &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} bold>${t("add.directionQuestion", { deck: deck.name })}<//>
            <${Box} marginTop=${1}>
              <${Choice}
                options=${[
                  { label: `${label(sample.front)} → ?`, note: t("add.youType", { answer: label(answers(sample.back)) }) },
                  { label: `${label(answers(sample.back))} → ?`, note: t("add.youType", { answer: label(sample.front) }) },
                  { label: t("add.bothWays"), note: t("add.bothWaysNote") }
                ]}
                selected=${direction}
                onMove=${setDirection}
                onPick=${pickDirection}
                onCancel=${() => pickDirection(0)}
              />
            <//>
            <${Box} marginTop=${1}><${Text} dimColor>${t("add.directionLater")}<//><//>
          <//>
        `}
        ${(step === "review" || step === "fix") &&
        pasted &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text}>${t("add.paste.summary", { lines: pasted.total, count: ready })}${shownPaste.some((item) => item.issue && !item.dropped) ? t("add.paste.attention", { count: shownPaste.filter((item) => item.issue && !item.dropped).length }) : ""}<//>
            <${Box} flexDirection="column" marginTop=${1}>
              ${shownPaste.slice(firstRow, firstRow + PASTE_ROWS).map((item, i) => {
                const index = firstRow + i;
                const on = index === pasted.selected && step === "review";
                const mark = item.dropped ? "✗" : item.issue ? "!" : "✓";
                const color = item.dropped ? undefined : item.issue ? theme.warn : theme.good;
                return html`
                  <${Box} key=${index} flexDirection=${narrow && item.issue && !item.dropped ? "column" : "row"}>
                    <${Box}>
                    <${Box} flexShrink=${0}>
                      <${Text} color=${on ? theme.accent : undefined}>${on ? "❯ " : "  "}<//>
                      <${Text} color=${color} dimColor=${item.dropped}>${mark} <//>
                    <//>
                    <${Box} flexGrow=${1}><${Text} dimColor=${item.dropped} strikethrough=${item.dropped} wrap="truncate-end">${item.fields.cloze ? plainFront(item.fields.front) : item.fields.back.length ? `${item.fields.front} = ${answers(item.fields.back)}` : item.fields.front}<//><//>
                    <//>
                    ${item.issue && !item.dropped && html`<${Box} flexShrink=${0} marginLeft=${narrow ? 4 : 0}><${Text} color=${theme.warn}>${narrow ? "" : "  "}${t(`add.paste.issues.${item.issue}`)}<//><//>`}
                  <//>
                `;
              })}
            <//>
            ${pasted.items.length > PASTE_ROWS && html`<${Text} dimColor>${t("add.paste.position", { at: pasted.selected + 1, count: pasted.items.length })}<//>`}
            ${pasted.confirm && html`<${Box} marginTop=${1}><${Text} color=${theme.warn}>${t("add.paste.confirm", { count: ready })}<//><//>`}
          <//>
        `}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}>
        <${KeyHints}
          text=${step === "direction"
            ? t("keyHints.directionPick", { choose: t("choice.keys") })
            : step === "pick"
            ? choiceHints("cancel")
            : step === "deck"
            ? t("keyHints.addName")
            : step === "review"
              ? t("keyHints.pasteReview", { count: ready })
              : step === "fix"
                ? t("keyHints.pasteFix")
                : step === "back"
                  ? t("keyHints.addBack")
                  : step === "line" && editing
                    ? t("keyHints.addFixing")
                    : step === "line" && added.length
                      ? t("keyHints.addMore")
                      : t("keyHints.addFirst")}
        />
      <//>
    <//>
  `;
}
