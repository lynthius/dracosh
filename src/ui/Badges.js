import { Fragment, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, PANEL_WIDTH, theme } from "./kit.js";
import { badgeColor, BadgeIcon, ICON_WIDTH } from "./icons.js";

// Two columns of badges with a pixel-icon preview of the selected one.
// ↑/↓ walk a column, ←/→ jump between columns, esc closes.
export function Badges({ badges, onClose }) {
  const [selected, setSelected] = useState(0);
  const rows = Math.ceil(badges.length / 2);
  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    if (key.upArrow) return setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSelected((s) => Math.min(badges.length - 1, s + 1));
    if (key.leftArrow) return setSelected((s) => Math.max(0, s - rows));
    if (key.rightArrow) return setSelected((s) => Math.min(badges.length - 1, s + rows));
  });

  const unlocked = badges.filter((b) => b.unlockedOn).length;
  const badge = badges[selected];

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Box}>
          <${Text} bold color=${theme.accent}>Badges<//>
          <${Text} dimColor>  ${unlocked}/${badges.length}<//>
        <//>

        <${Box} marginTop=${1}>
          <${Box} flexDirection="column" width=${ICON_WIDTH + 3}>
            <${BadgeIcon} id=${badge.id} locked=${!badge.unlockedOn} />
          <//>
          <${Box} flexDirection="column" justifyContent="center">
            <${Box}><${Text} bold color=${badge.unlockedOn ? badgeColor(badge.id) : undefined} dimColor=${!badge.unlockedOn}>${badge.name}<//><//>
            <${Box}><${Text}>${badge.desc}<//><//>
            <${Box}><${Text} dimColor>${badge.unlockedOn ? `unlocked ${badge.unlockedOn}` : "still locked"}<//><//>
          <//>
        <//>

        <${Box} marginTop=${1}>
          ${[0, 1].map(
            (column) => html`
              <${Box} key=${column} flexDirection="column" width=${column === 0 ? 34 : undefined}>
                ${badges.slice(column * rows, column * rows + rows).map((b, r) => {
                  const index = column * rows + r;
                  const current = index === selected;
                  return html`
                    <${Box} key=${b.id}>
                      <${Text} bold=${current} dimColor=${!current && !b.unlockedOn}>
                        <${Text} color=${current ? theme.accent : undefined}>${current ? "❯" : " "} <//>
                        <${Text} color=${b.unlockedOn ? badgeColor(b.id) : undefined}>${b.unlockedOn ? "●" : "○"} <//>
                        <${Text} color=${current ? theme.accent : b.unlockedOn ? theme.text : undefined}>${b.name}<//>
                      <//>
                    <//>
                  `;
                })}
              <//>
            `
          )}
        <//>
      <//>
      <${Box} paddingX=${1}><${Text} dimColor>↑/↓ browse · ←/→ column · esc back<//><//>
    <//>
  `;
}
