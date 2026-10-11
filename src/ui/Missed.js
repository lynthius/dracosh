import { t } from "../i18n.js";
import { Fragment, useState } from "react";
import { Box, useInput } from "ink";
import { html, KeyHints, Text, theme, usePanelWidth } from "./kit.js";

const MAX_ROWS = 10;

const dayLabel = (offset, date) => (offset === 0 ? t("missed.today") : offset === -1 ? t("missed.yesterday", { date }) : date);

// Words you got wrong on a day, with what you typed and whether you got them right afterwards.
export function Missed({ getMissed, onClose }) {
  const panel = usePanelWidth();
  const [offset, setOffset] = useState(0);
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") return onClose();
    if (key.leftArrow) return setOffset((o) => o - 1);
    if (key.rightArrow) return setOffset((o) => Math.min(0, o + 1));
  });

  const { date, items } = getMissed(offset);
  const shown = items.slice(0, MAX_ROWS);

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${panel}>
        <${Box}>
          <${Text} bold color=${theme.accent}>${t("missed.title")}<//>
          <${Text} dimColor>  ${dayLabel(offset, date)} · ${t("count.cards", { count: items.length })}<//>
        <//>
        ${items.length === 0
          ? html`<${Box} marginTop=${1}><${Text} dimColor>${t(offset === 0 ? "missed.nothingToday" : "missed.nothingThatDay")}<//><//>`
          : html`
              <${Box} flexDirection="column" marginTop=${1}>
                ${shown.map(
                  (item) => html`
                    <${Box} key=${item.key} flexDirection="column" marginBottom=${1}>
                      <${Text}>
                        <${Text} color=${item.recovered ? theme.good : theme.bad} bold>${item.recovered ? "✓" : "✗"}<//>
                        <${Text} bold>  ${item.prompt.replaceAll("`", "")}<//>
                        <${Text} dimColor>  ${item.label}${item.times > 1 ? t("missed.times", { count: item.times }) : ""}<//>
                      <//>
                      <${Text}>   ${item.expected.join(", ")}<//>
                      <${Text} dimColor>   ${item.answer ? t("missed.youWrote", { answer: item.answer }) : t("missed.noAnswer")}${item.recovered ? t("missed.recovered") : ""}<//>
                    <//>
                  `
                )}
                ${items.length > MAX_ROWS && html`<${Text} dimColor>${t("missed.more", { count: items.length - MAX_ROWS })}<//>`}
              <//>
            `}
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${t("missed.keys")} /><//>
    <//>
  `;
}
