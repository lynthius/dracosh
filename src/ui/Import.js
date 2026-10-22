import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../i18n.js";
import { plainFront } from "../cardline.js";
import { planCounts } from "../importer.js";
import { deckLanguages, isKnown, languageName } from "../language.js";
import { cardText, deckFromFile, describeRead, issueText, readImportFile } from "../transfer.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const SHOWN = 3; // cards of each deck, changed cards and lines that can't be added, before "… and N more"
const SETTLE_MS = 400; // a key right after a screen appears is the second half of the Enter before it

// A path as a terminal pastes a file dragged into it: in quotes, with its spaces escaped, or as a
// file:// address; "~" is your home folder
export function cleanPath(typed) {
  let path = typed.trim();
  if (/^(['"]).*\1$/.test(path)) path = path.slice(1, -1);
  else path = path.replace(/\\(.)/g, "$1");
  if (path.startsWith("file://")) {
    try {
      path = fileURLToPath(path);
    } catch {
      // not a file address after all: read as typed
    }
  }
  if (path === "~" || path.startsWith("~/")) path = homedir() + path.slice(1);
  return path && resolve(path);
}

const answers = (back) => back.join("; ");
const sideText = (card) => (card.cloze ? plainFront(card.front) : answers(card.back));

// the next question a file still needs, or the review once there is none
function stepFor(plan, choices) {
  if (plan.problems.some((p) => p.issue === "noDeck") && !choices.deckName) return "deck";
  if (plan.read.splittable && choices.split === null) return "split";
  return sampleOf(unaskedOf(plan, choices)) ? "direction" : "review";
}
const unaskedOf = (plan, choices) => plan.decks.filter((deck) => !deck.deck && !deck.direction && !choices.directions[deck.name]);
// a card of the decks still to be asked about, to show which way it would ask (cloze cards ask their gaps)
const sampleOf = (decks) => decks.flatMap((deck) => deck.items).find((item) => !item.fields.cloze)?.fields ?? null;

// /import: the same import as `dracosh import`, asked on screen. A file's path (typed, or a file dragged
// in), then the questions the file needs (which deck, several answers in one, which way new decks ask),
// then what it would do; nothing is saved before you say so, and Esc goes back a step. `actions`: the
// library's (manage.js); `fromWelcome`: opened from the welcome, where there was no tour to speak of.
// onDone({ deck, removed, added }) after an import: the deck to practise (null: stay), the tour's cards
// gone with it; onCancel when nothing was saved.
export function ImportScreen({ actions, onDone, onCancel, fromWelcome = false, read = readImportFile }) {
  const panel = usePanelWidth();
  const [step, setStep] = useState("path"); // path | reading | deck | split | direction | review | saving | done
  const [history, setHistory] = useState([]); // the steps behind this one, for Esc: { step, choices, plan }
  const [error, setError] = useState("");
  const [source, setSource] = useState(null); // { file, text, list, isPackage, csv }
  const [choices, setChoices] = useState(null);
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState(0);
  const [naming, setNaming] = useState(false); // typing another deck's name
  const [own, setOwn] = useState([]); // your decks, to put the cards in
  const [result, setResult] = useState(null);
  const [typed, setTyped] = useState({ text: "", key: 0 }); // the path as typed, kept when it can't be read
  const busy = useRef(false);
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [step, naming]);
  // a choice made by a double Enter, on a screen not yet seen, doesn't count
  const settled = (pick) => (...args) => (Date.now() - shownAt.current < SETTLE_MS ? undefined : pick(...args));

  useEffect(() => {
    actions.ownDecks().then(setOwn, () => {});
  }, []);

  useInput((input, key) => {
    if (step === "done" && (key.return || key.escape) && Date.now() - shownAt.current >= SETTLE_MS) onDone(result.next);
  });

  function advance(made, picked, from = { step, choices, plan }) {
    setHistory((list) => [...list, from]);
    setPlan(made);
    setChoices(picked);
    setSelected(0);
    setNaming(false);
    setError("");
    setStep(stepFor(made, picked));
  }

  // one step back; from the first question, back to the path; from the path, out
  function back() {
    if (naming) return setNaming(false);
    const last = history.at(-1);
    if (!last || step === "path") return onCancel();
    setHistory((list) => list.slice(0, -1));
    setStep(last.step);
    setChoices(last.choices);
    setPlan(last.plan);
    setSelected(0);
    setError("");
  }

  async function replan(picked) {
    try {
      const made = await actions.previewImport(source, picked);
      // a deck name that can't take the cards (the tour's, or too long) is asked again
      const refused = step === "deck" && made.problems.find((p) => p.issue === "tour" || p.issue === "tooLong");
      if (refused && !made.decks.length) return setError(issueText(refused, source.isPackage));
      advance(made, picked);
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(text) {
    setTyped((now) => ({ text, key: now.key + 1 }));
    const file = cleanPath(text);
    if (!file) return setError(t("importScreen.needPath"));
    setError("");
    setStep("reading");
    try {
      const src = { file, ...(await read(file)) };
      const picked = { deck: null, deckName: null, csv: src.csv, directions: {}, split: null };
      const made = await actions.previewImport(src, { ...picked, split: false });
      if (!made.read.count) throw new Error(t("importScreen.empty"));
      setSource(src);
      advance(made, picked, { step: "path", choices: null, plan: null });
    } catch (err) {
      setError(err.message);
      setStep("path");
    }
  }

  async function save(update) {
    if (busy.current) return;
    busy.current = true;
    setStep("saving");
    try {
      const done = await actions.importCards(source, { ...choices, split: Boolean(choices.split) }, { update });
      const first = done.decks.find((deck) => deck.isNew && deck.added) ?? done.decks.find((deck) => deck.added) ?? done.decks.find((deck) => deck.updated);
      setResult({ ...done, next: { deck: first?.name ?? null, removed: done.removedTour, added: done.added, updated: done.updated } });
      setStep("done");
    } catch (err) {
      setError(t("quiz.saveFailed", { error: err.message }));
      setStep("review");
    } finally {
      busy.current = false;
    }
  }

  const frame = (body, hints) => html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("importScreen.title")}<//>
        ${source && plan && step !== "path" && step !== "reading" && html`<${Text} dimColor>${t("import.reading", { file: basename(source.file), what: describeRead(plan.read) })}<//>`}
        ${body}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${hints} /><//>
    <//>
  `;
  const indented = (key, content, props = {}) => html`<${Box} key=${key} paddingLeft=${2}><${Text} ...${props}>${content}<//><//>`;

  if (step === "path" || step === "reading")
    return frame(
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text}>${t("importScreen.pathLabel")}<//>
          <${Text} dimColor>${t("importScreen.pathHint")}<//>
          <${Box} marginTop=${1}>${step === "reading" ? html`<${Text} dimColor>${t("importScreen.reading")}<//>` : html`<${AnswerInput} key=${typed.key} plain escLeaves initial=${typed.text} onSubmit=${open} onExit=${onCancel} onChange=${() => setError("")} />`}<//>
        <//>
      `,
      t("keyHints.importPath")
    );

  if (step === "deck") {
    const suggested = deckFromFile(source.file);
    const sample = plan.problems.filter((p) => p.issue === "noDeck").slice(0, SHOWN);
    const mine = own.find((deck) => deck.name.toLowerCase() === suggested.toLowerCase());
    const options = [
      ...(suggested && !mine ? [{ name: suggested, label: t("importScreen.newDeck", { deck: suggested }) }] : []),
      ...own.map((deck) => ({ name: deck.name, label: deck.name, note: t("count.cards", { count: deck.cards }) })),
      { name: null, label: t("importScreen.otherName") }
    ];
    const pick = (i) => (options[i].name ? replan({ ...choices, deckName: options[i].name }) : setNaming(true));
    return frame(
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text} dimColor>${t("importScreen.fromFile")}<//>
          ${sample.map((p, i) => indented(i, p.text.replace(/\t/g, "  "), { dimColor: true, wrap: "truncate-end" }))}
          <${Box} marginTop=${1}><${Text} bold>${t("importScreen.deckLabel")}<//><//>
          <${Box} marginTop=${1}>
            ${naming
              ? html`<${AnswerInput} plain escLeaves onSubmit=${(name) => (name.trim() ? replan({ ...choices, deckName: name.trim() }) : setError(t("add.needName")))} onExit=${back} onChange=${() => setError("")} />`
              : html`<${Choice} options=${options} selected=${Math.min(selected, options.length - 1)} onMove=${setSelected} onPick=${settled(pick)} onCancel=${back} />`}
          <//>
        <//>
      `,
      naming ? t("keyHints.importName") : choiceHints("back")
    );
  }

  if (step === "split")
    return frame(
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text}>${t("import.listed", { count: plan.read.splittable, example: cutToWidth(plan.read.splitExample, 40) })}<//>
          <${Text} bold>${t("import.splitAsk")}<//>
          <${Box} marginTop=${1}><${Choice} options=${[{ label: t("importScreen.splitYes") }, { label: t("importScreen.splitNo") }]} selected=${selected} onMove=${setSelected} onPick=${settled((i) => replan({ ...choices, split: i === 0 }))} onCancel=${back} /><//>
        <//>
      `,
      choiceHints("back")
    );

  if (step === "direction") {
    const unasked = unaskedOf(plan, choices);
    const sample = sampleOf(unasked);
    const ways = ["forward", "backward", "both"];
    const options = [
      { label: `${cutToWidth(sample.front, 24)} → ?`, note: t("add.youType", { answer: cutToWidth(answers(sample.back), 24) }) },
      { label: `${cutToWidth(answers(sample.back), 24)} → ?`, note: t("add.youType", { answer: cutToWidth(sample.front, 24) }) },
      { label: t("add.bothWays"), note: t("add.bothWaysNote") }
    ];
    const pick = (i) => replan({ ...choices, directions: { ...choices.directions, ...Object.fromEntries(unasked.map((deck) => [deck.name, ways[i]])) } });
    return frame(
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          <${Text} bold>${unasked.length === 1 ? t("add.directionQuestion", { deck: unasked[0].name }) : t("import.directionTitleMany", { count: unasked.length })}<//>
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${selected} onMove=${setSelected} onPick=${settled(pick)} onCancel=${back} /><//>
          <${Box} marginTop=${1}><${Text} dimColor>${t("add.directionLater")}<//><//>
        <//>
      `,
      choiceHints("back")
    );
  }

  if (step === "done") {
    const lines = result.decks.map((deck) =>
      deck.isNew ? t("import.doneNew", { deck: deck.name, count: deck.added }) : !deck.added ? t("import.doneOnlyUpdated", { deck: deck.name, count: deck.updated }) : t("import.done", { deck: deck.name, count: deck.added }) + (deck.updated ? t("import.doneUpdated", { count: deck.updated }) : "")
    );
    return frame(
      html`
        <${Box} flexDirection="column" marginTop=${1}>
          ${lines.map((line, i) => html`<${Text} key=${i} color=${theme.good}>✓ ${line}<//>`)}
          ${result.slash.length > 0 && html`<${Text} dimColor>${t("importScreen.slashLeft", { count: result.slash.length })}<//>`}
          ${result.removedTour.length > 0 && !fromWelcome && html`<${Text} dimColor>${t("import.tourGone")}<//>`}
          ${result.backedUp && html`<${Text} dimColor>${t("importScreen.undo")}<//>`}
          ${result.next.deck && html`<${Box} marginTop=${1}><${Text}>${t("importScreen.practise", { deck: result.next.deck })}<//><//>`}
        <//>
      `,
      t("keyHints.importDone")
    );
  }

  // review (and saving): what the file would add and change, and the go-ahead
  const counts = planCounts(plan);
  const problems = plan.problems.filter((p) => p.issue !== "noDeck");
  const changed = plan.decks.flatMap((deck) => deck.items.filter((item) => item.kind === "changed"));
  const nested = source.isPackage && plan.decks.find((deck) => !deck.deck && deck.name.includes("::"));
  const options = [
    counts.new > 0 && { id: "add", label: t("importScreen.add", { count: counts.new }) },
    counts.changed > 0 && { id: "both", label: counts.new ? t("importScreen.addUpdate", { cards: t("count.cards", { count: counts.new }), count: counts.changed }) : t("importScreen.update", { count: counts.changed }) },
    { id: "cancel", label: counts.new || counts.changed ? t("importScreen.cancel") : t("importScreen.close") }
  ].filter(Boolean);
  return frame(
    html`
      <${Box} flexDirection="column">
        ${plan.decks.map((target) => {
          const added = target.items.filter((item) => item.kind === "new");
          if (target.deck && !added.length) return null;
          const languages = !target.deck && deckLanguages({ name: target.name }, target.items.map((item) => item.fields));
          const sure = languages && isKnown(languages.front) && isKnown(languages.back) && languages.front !== languages.back;
          return html`
            <${Box} key=${target.name} flexDirection="column" marginTop=${1}>
              <${Text} bold>${target.deck ? t("import.intoDeck", { deck: target.name, cards: t("count.cards", { count: target.cards }) }) : t("import.intoNewDeck", { deck: target.name })}<//>
              ${added.slice(0, SHOWN).map((item, i) => indented(i, html`<${Fragment}><${Text} color=${theme.good}>+<//> ${cardText(item.fields)}${item.fields.example ? html`<${Text} dimColor>  // ${item.fields.example}<//>` : ""}<//>`, { wrap: "truncate-end" }))}
              ${added.length > SHOWN && indented("more", t("import.more", { count: added.length - SHOWN }), { dimColor: true })}
              ${languages && indented("languages", sure ? t("import.languagesGuess", { front: languageName(languages.front), back: languageName(languages.back) }) : t("import.languagesUnsure"), { dimColor: true })}
            <//>
          `;
        })}
        ${nested && html`<${Box} marginTop=${1}><${Text} dimColor>${t("import.subdecks", { deck: nested.name })}<//><//>`}
        <${Box} marginTop=${1}><${Text}>${[t("import.counts.new", { count: counts.new }), counts.same && t("import.counts.same", { count: counts.same }), counts.changed && t("import.counts.changed", { count: counts.changed })].filter(Boolean).join(" · ")}<//><//>
        ${changed.length > 0 &&
        html`
          <${Box} flexDirection="column">
            ${changed.slice(0, SHOWN).map((item, i) => indented(i, `~ ${plainFront(item.card.front)}: ${sideText(item.card)} → ${sideText(item.fields)}`, { wrap: "truncate-end" }))}
            ${changed.length > SHOWN && indented("more", t("import.more", { count: changed.length - SHOWN }), { dimColor: true })}
            <${Text} dimColor>${t("importScreen.changedNote")}<//>
          <//>
        `}
        ${problems.length > 0 &&
        html`
          <${Box} flexDirection="column" marginTop=${1}>
            <${Text} color=${theme.warn}>${t(source.isPackage ? "import.problemsNotes" : "import.problems", { count: problems.length })}<//>
            ${problems.slice(0, SHOWN).map((p, i) => indented(i, t(source.isPackage ? "importScreen.problemNote" : "importScreen.problemLine", { line: p.line, issue: issueText(p, source.isPackage), text: p.text.replace(/\t/g, "  ") }), { dimColor: true, wrap: "truncate-end" }))}
            ${problems.length > SHOWN && indented("more", t("import.more", { count: problems.length - SHOWN }), { dimColor: true })}
          <//>
        `}
        ${plan.read.media > 0 && html`<${Text} dimColor>${t("import.mediaLeft", { count: plan.read.media })}<//>`}
        ${plan.read.ignored.length > 0 && html`<${Text} dimColor>${t("import.ignored", { count: plan.read.ignored.length, lines: plan.read.ignored.slice(0, 5).join(", ") + (plan.read.ignored.length > 5 ? "…" : "") })}<//>`}
        ${plan.read.anki && !plan.read.html && html`<${Text} color=${theme.warn}>${t("import.ankiNoHtml")}<//>`}
        ${!counts.new && !counts.changed && html`<${Box} marginTop=${1}><${Text}>${t("import.nothing")}<//><//>`}
        <${Box} marginTop=${1}>
          ${step === "saving"
            ? html`<${Text} dimColor>${t("importScreen.saving")}<//>`
            : html`<${Choice} options=${options} selected=${Math.min(selected, options.length - 1)} onMove=${setSelected} onPick=${settled((i) => (options[i].id === "cancel" ? onCancel() : save(options[i].id === "both")))} onCancel=${back} />`}
        <//>
      <//>
    `,
    choiceHints("back")
  );
}
