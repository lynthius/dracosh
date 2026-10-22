import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { entry, language, LANGUAGES, t } from "../i18n.js";
import { FIRST_WORDS_LANGUAGES, hasFirstWords } from "../firstwords.js";
import { languageName, UNKNOWN } from "../language.js";
import { Choice, choiceHints } from "./Choice.js";
import { html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";
import { LanguageSearch } from "./Languages.js";

export const WELCOME_STEPS = ["language", "home", "learning", "start"];
const FIRST_WORDS_COUNT = 30;

// After the hatching, before the first question: the app's language, the one you speak, the one you're
// learning, and a way to start. Every answer is kept as it's given (onStep), so a welcome left halfway
// goes on from that step. `onPreviewLanguage` shows the texts in a language while it's only selected;
// onStart(how): "words" (the first words of the pair), "tour", "import" (cards you have, /import) or
// "own" (a deck of your own, in /add).
// `tour`: whether there's still a tour to show (a deck of your own may have taken its place).
export function Welcome({ step, settings, tour = true, onPreviewLanguage, onStep, onStart }) {
  const panel = usePanelWidth();
  const codes = Object.keys(LANGUAGES);
  const [selected, setSelected] = useState(() => Math.max(0, codes.indexOf(settings.language ?? language())));
  const [startAt, setStartAt] = useState(0);
  const home = settings.homeLanguage ?? language();
  const learning = settings.learningLanguage === UNKNOWN ? null : settings.learningLanguage; // "something else" is kept as UNKNOWN
  const counter = `${WELCOME_STEPS.indexOf(step) + 1}/${WELCOME_STEPS.length}`;
  const hints = (text) => `${counter} · ${text}`;

  // ← goes back on the last step too, as it does in the language lists before it
  useInput((input, key) => {
    if (step === "start" && key.leftArrow) onStep("learning");
  });

  if (step === "home")
    return html`<${LanguageSearch} key="home" title=${t("welcome.homeTitle")} note=${t("welcome.homeNote")} current=${home} currentNote=${settings.homeLanguage ? t("languages.current") : t("welcome.suggested")} step=${counter} onBack=${() => onStep("language")} onPick=${(code) => onStep("learning", { homeLanguage: code, ...(code === learning && { learningLanguage: null }) })} />`;
  if (step === "learning")
    return html`<${LanguageSearch} key="learning" title=${t("welcome.learningTitle")} note=${t("welcome.learningNote")} current=${settings.learningLanguage !== home ? settings.learningLanguage : null} exclude=${[home]} other=${t("welcome.notLanguage")} step=${counter} onBack=${() => onStep("home")} onPick=${(code) => onStep("start", { learningLanguage: code })} />`;

  if (step === "start") {
    const words = learning && hasFirstWords(home, learning);
    const options = [
      words && { id: "words", label: t("welcome.start.words", { count: FIRST_WORDS_COUNT }), note: t("welcome.start.wordsNote", { language: languageName(learning), home: languageName(home) }) },
      tour && { id: "tour", label: t("welcome.start.tour"), note: t("welcome.start.tourNote", { count: entry("tour.cards").length }) },
      { id: "import", label: t("welcome.start.import"), note: t("welcome.start.importNote") },
      { id: "own", label: t("welcome.start.own"), note: t("welcome.start.ownNote") }
    ].filter(Boolean);
    // no ready-made words for this pair: said why, naming the language that has none
    const names = () => new Intl.ListFormat(language(), { type: "conjunction" }).format(FIRST_WORDS_LANGUAGES.map((code) => languageName(code)));
    const missing = !learning || words ? null : FIRST_WORDS_LANGUAGES.includes(learning) ? "home" : "learning";
    const why = missing && (missing === "home" ? t("welcome.start.noWordsHome", { languages: names(), language: languageName(home) }) : t("welcome.start.noWords", { languages: names(), language: languageName(learning) }));
    return html`
      <${Fragment}>
        <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
          <${Text} bold color=${theme.accent}>${t("welcome.startTitle")}<//>
          <${Text} dimColor>${t("welcome.startNote")}<//>
          <${Box} marginTop=${1}><${Choice} options=${options} selected=${Math.min(startAt, options.length - 1)} onMove=${setStartAt} onPick=${(i) => onStart(options[i].id)} onCancel=${() => onStep("learning")} /><//>
          ${why && html`<${Box} marginTop=${1}><${Text} dimColor>${why}<//><//>`}
        <//>
        <${Box} paddingX=${1}><${KeyHints} text=${hints(choiceHints("back"))} /><//>
      <//>
    `;
  }

  // the app's language: each named in itself, and the texts follow the one selected
  const move = (i) => {
    setSelected(i);
    onPreviewLanguage(codes[i]);
  };
  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("welcome.languageTitle")}<//>
        <${Text} dimColor>${t("welcome.languageNote")}<//>
        <${Box} marginTop=${1}><${Choice} options=${codes.map((code) => ({ label: LANGUAGES[code] }))} selected=${selected} onMove=${move} onPick=${(i) => onStep("home", { language: codes[i] })} /><//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${hints(t("choice.keys"))} /><//>
    <//>
  `;
}
