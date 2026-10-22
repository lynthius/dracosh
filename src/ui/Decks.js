import { Fragment, useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { t } from "../i18n.js";
import { AnswerInput } from "./AnswerInput.js";
import { Choice, choiceHints } from "./Choice.js";
import { LanguagePicker, pairText } from "./Languages.js";
import { isKnown, languageName } from "../language.js";
import { TRASH_DAYS } from "../library.js";
import { cutToWidth, html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const DIRECTIONS = ["forward", "backward", "both"];

// /decks: your decks with their card counts; Enter quizzes the chosen one from now on, and
// "+ New deck" starts one (`onNew`). → on a deck of yours: which way it's asked, its languages, its
// name, and Delete: asked first, then into the trash, and u brings it straight back. `onDeleted`
// ({ cardIds, next }) and `onRestored`({ deck, progress, removed }) let the app follow (progress, the
// deck practised); `onRenamed`(from, to) too. Space marks decks to practise together (`mix`: "all" or
// their names, set with `onPractise`({ deck, mix })), and "All decks" takes every deck of yours.
export function Decks({ current, mix = null, actions, onPick, onPractise, onNew, onClose, onDirections, onLanguages, onDeleted, onRestored, onRenamed, onMerged }) {
  const panel = usePanelWidth();
  const [decks, setDecks] = useState(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(null); // { deck, selected }: a deck's settings
  const [setting, setSetting] = useState(null); // { deck, selected }: the direction being picked
  const [naming, setNaming] = useState(null); // the deck whose languages are being picked
  const [renaming, setRenaming] = useState(null); // the deck being renamed
  const [deleting, setDeleting] = useState(null); // { deck, selected }: Delete, asked first
  const [merging, setMerging] = useState(null); // { deck, into, selected }: Merge into another deck, then asked
  const [undo, setUndo] = useState(null); // { entry, name }: the deck just deleted, u brings it back
  const saving = useRef(false);
  const [message, setMessage] = useState("");

  const reload = (select) =>
    actions.allDecks().then(
      (all) => {
        setDecks(all);
        setPicked(Math.max(0, all.findIndex((d) => d.name === select)));
      },
      (err) => setError(err.message)
    );
  useEffect(() => {
    reload(current);
  }, []);

  useInput((input, key) => {
    if (!decks?.length && (key.escape || input === "q")) onClose();
    const listing = !menu && !setting && !naming && !renaming && !deleting && !merging && !saving.current;
    if (input === "u" && undo && listing) return restore();
    const deck = decks?.[picked];
    if (input === " " && listing && deck && !deck.tour && own.length >= 2) return together(deck);
    // → into a deck's settings, ← back out of them (Esc works too)
    if (key.leftArrow && !naming && !renaming && !deleting && !merging) {
      if (setting) return setSetting(null);
      if (menu) return setMenu(null);
    }
    // not while a change is still being saved: the menu would show the deck as it was
    if (key.rightArrow && !menu && !setting && !naming && !renaming && !deleting && !merging && !saving.current && deck && !deck.tour) {
      setMessage("");
      setUndo(null);
      setMenu({ deck, selected: 0 });
    }
  });

  // progress of a direction turned off stays: turning it back on picks up where it was
  async function setDirections(index) {
    const { deck } = setting;
    setSetting(null);
    setMenu(null);
    if (DIRECTIONS[index] === deck.directions) return; // nothing changed, nothing to say
    saving.current = true;
    try {
      const { cardIds } = await actions.setDirections(deck.name, DIRECTIONS[index]);
      await onDirections?.(cardIds, DIRECTIONS[index]);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, directions: DIRECTIONS[index] } : d)));
      setMessage(t("decks.directionSaved", { deck: deck.name }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  // your decks, and the ones practised now: every one for "all", the marked ones, or the one deck
  const own = (decks ?? []).filter((d) => !d.tour);
  const practised = mix === "all" ? own.map((d) => d.name) : mix ?? [current];

  // space on a deck: in or out of the decks practised together (one left is that deck alone)
  function together(deck) {
    setMessage("");
    const now = practised.filter((name) => own.some((d) => d.name === name));
    const next = now.includes(deck.name) ? now.filter((name) => name !== deck.name) : [...now, deck.name];
    if (!next.length) return setMessage(t("decks.onlyOne", { deck: deck.name }));
    const main = next.includes(current) ? current : next[0];
    onPractise({ deck: main, mix: next.length >= 2 ? (next.length === own.length && mix === "all" ? "all" : next) : null });
    setMessage(next.length >= 2 ? t("decks.togetherNow", { count: next.length }) : t("decks.aloneNow", { deck: next[0] }));
  }

  // the menu stays underneath: Esc in the direction or language picker comes back to it
  const menuRows = (deck) => ["ask", "languages", ...(deck.learning ? ["learning"] : []), ...(deck.languages.guessed ? [] : ["detect"]), "rename", ...(own.length >= 2 ? ["merge"] : []), "delete"];
  function openSetting(index) {
    const { deck } = menu;
    setMenu((m) => ({ ...m, selected: index })); // coming back, the cursor is on the row you opened
    const row = menuRows(deck)[index];
    if (row === "ask") return setSetting({ deck, selected: Math.max(0, DIRECTIONS.indexOf(deck.directions)) });
    if (row === "languages") return setNaming(deck);
    if (row === "learning") return setNaming({ ...deck, only: "learning" });
    if (row === "rename") return setRenaming(deck);
    if (row === "delete") return setDeleting({ deck, selected: 1 }); // Cancel first: Enter by habit keeps the deck
    if (row === "merge") return setMerging({ deck, into: null, selected: 0 });
    setLanguages(null, deck); // detect them from the cards again
  }

  async function rename(deck, name) {
    if (saving.current) return;
    if (name.trim() === deck.name) return setRenaming(null);
    saving.current = true;
    try {
      const renamed = await actions.renameDeck(deck.name, name);
      setRenaming(null);
      setMenu(null);
      onRenamed?.(deck.name, renamed.name);
      await reload(renamed.name);
      setMessage(t("decks.renamed", { from: deck.name, to: renamed.name }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  async function remove(deck) {
    if (saving.current) return;
    saving.current = true;
    setDeleting(null);
    setMenu(null);
    try {
      const done = await onDeleted(deck.name);
      setUndo({ entry: done.entry, name: deck.name });
      await reload(done.next === deck.name ? null : current === deck.name ? done.next : current);
      setMessage(t("decks.deleted", { deck: deck.name, days: TRASH_DAYS }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  async function merge(from, into) {
    if (saving.current) return;
    saving.current = true;
    setMerging(null);
    setMenu(null);
    try {
      const done = await onMerged(from.name, into.name);
      setUndo({ entry: done.entry, name: from.name });
      await reload(into.name);
      setMessage(t("decks.merged", { from: from.name, into: into.name, count: done.moved.length }) + (done.left.length ? ` ${t("decks.mergedLeft", { count: done.left.length })}` : ""));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  async function restore() {
    saving.current = true;
    try {
      const back = await onRestored(undo.entry);
      setUndo(null);
      await reload(back.deck);
      setMessage(t("decks.restored", { deck: back.deck }));
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  // the language you're learning in the deck (pronunciation reads it, "almost" applies to it)
  async function saveLearning(deck, lang) {
    setNaming(null);
    setMenu(null);
    saving.current = true;
    try {
      const learning = await actions.setLearning(deck.name, lang);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, learning } : d)));
      setMessage(t("languages.learningSaved", { deck: deck.name, language: languageName(learning?.lang) }));
      onLanguages?.(deck.name);
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  async function setLanguages(languages, deck = naming) {
    setNaming(null);
    setMenu(null);
    saving.current = true;
    try {
      const saved = await actions.setLanguages(deck.name, languages);
      setDecks((all) => all.map((d) => (d.name === deck.name ? { ...d, languages: saved, learning: saved.learning } : d)));
      setMessage(
        !languages ? t("languages.detecting", { deck: deck.name }) : saved.learning ? t("languages.savedWithLearning", { deck: deck.name, pair: pairText(saved), language: languageName(saved.learning.lang) }) : t("languages.saved", { deck: deck.name, pair: pairText(saved) })
      );
      onLanguages?.(deck.name);
    } catch (err) {
      setError(err.message);
    } finally {
      saving.current = false;
    }
  }

  const short = (text) => cutToWidth(text, Math.max(12, Math.floor(panel / 2) - 8));
  const directionOptions = (deck) => {
    const [front, back] = deck.sample ? [short(deck.sample.front), short(deck.sample.back.join(" / "))] : [t("decks.front"), t("decks.back")];
    return [
      { label: `${front} → ?`, note: deck.directions === "forward" ? t("languages.current") : "" },
      { label: `${back} → ?`, note: deck.directions === "backward" ? t("languages.current") : "" },
      { label: t("add.bothWays"), note: deck.directions === "both" ? t("languages.current") : "" }
    ];
  };

  if (naming)
    return html`<${LanguagePicker}
      deck=${naming.name}
      sample=${naming.sample}
      languages=${naming.languages}
      learning=${naming.learning}
      home=${naming.home}
      start=${naming.only ?? "front"}
      onDone=${(picked) => (naming.only ? saveLearning(naming, picked.learning) : setLanguages(picked))}
      onCancel=${() => setNaming(null)}
    />`;

  if (setting) return directionPicker();

  if (renaming)
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("decks.renameTitle", { deck: renaming.name })}<//>
          <${Box} marginTop=${1}><${AnswerInput} plain escLeaves initial=${renaming.name} onSubmit=${(name) => rename(renaming, name)} onExit=${() => (setRenaming(null), setError(""))} onChange=${() => setError("")} /><//>
          ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.rename")} /><//>
      <//>
    `;

  // two decks whose cards are in other languages: merging them is likely a slip
  const differ = (a, b) => [a, b].every((d) => isKnown(d.languages.front) && isKnown(d.languages.back)) && (a.languages.front !== b.languages.front || a.languages.back !== b.languages.back);

  if (merging) {
    const { deck } = merging;
    const others = own.filter((d) => d.name !== deck.name);
    const back = () => setMerging(null);
    if (!merging.into)
      return html`
        <${Fragment}>
          <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
            <${Text} bold color=${theme.accent}>${t("decks.mergeTitle", { deck: deck.name })}<//>
            <${Box} marginTop=${1}><${Choice} options=${others.map((d) => ({ label: d.name, note: t("count.cards", { count: d.cards }) }))} selected=${merging.selected} onMove=${(selected) => setMerging((m) => ({ ...m, selected }))} onPick=${(i) => setMerging((m) => ({ ...m, into: others[i], selected: 1 }))} onCancel=${back} /><//>
          <//>
          <${Box} paddingX=${1}><${KeyHints} text=${choiceHints("back")} /><//>
        <//>
      `;
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.warn} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.warn}>${t("decks.mergeQuestion", { from: deck.name, into: merging.into.name, cards: t("count.cards", { count: deck.cards }) })}<//>
          <${Text} dimColor>${t("decks.mergeNote", { from: deck.name, into: merging.into.name, days: TRASH_DAYS })}<//>
          ${differ(deck, merging.into) && html`<${Text} color=${theme.warn}>${t("decks.mergeLanguages", { from: deck.name, into: merging.into.name, fromPair: pairText(deck.languages), intoPair: pairText(merging.into.languages) })}<//>`}
          <${Box} marginTop=${1}><${Choice} options=${[{ label: t("decks.mergeYes") }, { label: t("decks.mergeNo") }]} selected=${merging.selected} onMove=${(selected) => setMerging((m) => ({ ...m, selected }))} onPick=${(i) => (i === 0 ? merge(deck, merging.into) : back())} onCancel=${() => setMerging((m) => ({ ...m, into: null, selected: 0 }))} /><//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${choiceHints("back")} /><//>
      <//>
    `;
  }

  if (deleting) {
    const { deck } = deleting;
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.bad} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.bad}>${t("decks.deleteQuestion", { deck: deck.name, cards: t("count.cards", { count: deck.cards }) })}<//>
          <${Text} dimColor>${t("decks.deleteNote", { days: TRASH_DAYS })}<//>
          <${Box} marginTop=${1}>
            <${Choice} options=${[{ label: t("decks.deleteYes"), danger: true }, { label: t("decks.deleteNo") }]} selected=${deleting.selected} onMove=${(selected) => setDeleting((d) => ({ ...d, selected }))} onPick=${(i) => (i === 0 ? remove(deck) : setDeleting(null))} onCancel=${() => setDeleting(null)} />
          <//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${choiceHints("cancel")} /><//>
      <//>
    `;
  }

  if (menu) {
    const { deck } = menu;
    const guessedNote = deck.languages.guessed && deck.cards > 0 && (isKnown(deck.languages.front) || isKnown(deck.languages.back)) ? ` · ${t("languages.guessed")}` : "";
    const how = directionOptions(deck)[Math.max(0, DIRECTIONS.indexOf(deck.directions))].label;
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${deck.name}<//>
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[
                { label: t("decks.askRow"), note: deck.directions === "both" ? t("add.bothWays") : how },
                { label: t("decks.languagesRow"), note: pairText(deck.languages) + guessedNote },
                ...(deck.learning ? [{ label: t("decks.learningRow"), note: languageName(deck.learning.lang) + (deck.learning.sure ? "" : ` · ${t("languages.guessShort")}`) }] : []),
                ...(deck.languages.guessed ? [] : [{ label: t("decks.detectRow") }]),
                { label: t("decks.renameRow") },
                ...(own.length >= 2 ? [{ label: t("decks.mergeRow") }] : []),
                { label: t("decks.deleteRow"), note: t("count.cards", { count: deck.cards }), danger: true }
              ]}
              selected=${menu.selected}
              onMove=${(selected) => setMenu((m) => ({ ...m, selected }))}
              onPick=${openSetting}
              onCancel=${() => setMenu(null)}
            />
          <//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.choiceLeft", { choose: t("choice.keys") })} /><//>
      <//>
    `;
  }

  function directionPicker() {
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("add.directionQuestion", { deck: setting.deck.name })}<//>
          <${Box} marginTop=${1}>
            <${Choice} options=${directionOptions(setting.deck)} selected=${setting.selected} onMove=${(selected) => setSetting((s) => ({ ...s, selected }))} onPick=${setDirections} onCancel=${() => setSetting(null)} />
          <//>
          <${Box} marginTop=${1}><${Text} dimColor>${t("decks.progressKept")}<//><//>
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.choiceLeft", { choose: t("choice.keys") })} /><//>
      <//>
    `;
  }

  const mixing = own.length >= 2; // with two decks or more, each shows whether it's practised (space)
  // a deck's languages show in the list once the cards tell at least one
  const languagesNote = (d) => (d.tour || !d.cards ? "" : d.learning ? t("decks.learningShort", { language: languageName(d.learning.lang) }) : isKnown(d.languages.front) && isKnown(d.languages.back) ? pairText(d.languages) : "");

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("decks.title")}<//>
        ${decks?.length > 0 &&
        html`
          <${Box} marginTop=${1}>
            <${Choice}
              options=${[
                ...decks.map((d) => ({ label: `${mixing ? (practised.includes(d.name) ? "■ " : "□ ") : ""}${d.name}`, note: [t("count.cards", { count: d.cards }), languagesNote(d), d.tour && t("decks.tour"), !mix && d.name === current && t("decks.now")].filter(Boolean).join(" · ") })),
                ...(own.length >= 2 ? [{ label: t("decks.allRow"), note: [t("count.decks", { count: own.length }), mix === "all" && t("decks.now")].filter(Boolean).join(" · ") }] : []),
                { label: t("decks.newDeck") }
              ]}
              selected=${picked}
              onMove=${setPicked}
              onPick=${(i) => (i === decks.length && own.length >= 2 ? (onPractise({ deck: current, mix: "all" }), onClose()) : i >= decks.length ? onNew() : onPick(decks[i].name))}
              onCancel=${onClose}
            />
          <//>
        `}
        ${message && html`<${Box} marginTop=${1}><${Text} color=${theme.good}>${message}<//><//>`}
        ${error && html`<${Box} marginTop=${1}><${Text} color=${theme.bad}>${error}<//><//>`}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${(undo ? `${t("keyHints.undo")} · ` : "") + (decks?.[picked] && !decks[picked].tour ? (mix ? t("keyHints.decksMixing") : t(own.length >= 2 ? "keyHints.decksTogether" : "keyHints.decks", { choose: choiceHints() })) : choiceHints())} /><//>
    <//>
  `;
}
