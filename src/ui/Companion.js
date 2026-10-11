import { t } from "../i18n.js";
import { Fragment } from "react";
import { Box, Text, useInput } from "ink";
import { dragonName, elementName, STAGES } from "../progress.js";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";
import { ELEMENT_COLOR, Mascot } from "./Mascot.js";

const requirement = (stage, locked) => (stage.from === 0 ? t("companion.fromStart") : t(locked ? "companion.needsDays" : "companion.days", { count: stage.from }));

// Every form of the companion. Forms you haven't reached are flat silhouettes named "???".
// Its moods aren't listed here on purpose: you find them out by playing.
export function Companion({ current, best, element = null, roll = null, onClose }) {
  const panel = usePanelWidth();
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") onClose();
  });

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Text} bold color=${theme.accent}>${t("companion.title")}<//>
        <${Box} marginTop=${1}>
          <${Text}>${t("companion.yourDragon")}<//>
          <${Text} bold color=${element ? ELEMENT_COLOR[element] : undefined}>${dragonName(current, element)}<//>
        <//>
        <${Text} dimColor>${element ? `${t("companion.element", { element: elementName(element) })}${roll ? t("companion.rolled", { face: roll.face, day: roll.on }) : ""}` : t("companion.noElement")}<//>
        <${Box} marginTop=${1}><${Text} dimColor>${t("companion.evolves", { count: best })}<//><//>

        <${Box} marginTop=${1} flexWrap="wrap">
          ${STAGES.map((stage, i) => {
            const locked = i > current;
            return html`
              <${Box} key=${stage.id} width=${22} flexDirection="column" marginBottom=${1}>
                <${Box} flexDirection="column"><${Mascot} stage=${i} locked=${locked} face=${locked ? "idle" : "smile"} element=${element} /><//>
                <${Text} bold=${i === current} color=${i === current ? theme.accent : undefined} dimColor=${locked}>${locked ? t("companion.unknown") : stage.name}${i === current ? t("companion.now") : ""}<//>
                <${Text} dimColor>${requirement(stage, locked)}<//>
              <//>
            `;
          })}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("keyHints.back")} /><//>
    <//>
  `;
}
