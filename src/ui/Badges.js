import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, KeyHints, PANEL_WIDTH, theme } from "./kit.js";
import { badgeColor, BadgeIcon, ICON_WIDTH } from "./icons.js";

const COLUMNS = 3;
const COLUMN_WIDTH = 22; // fits "❯ ● " plus the longest badge name

// badges won since the last visit light up one after another
const FRAME_MS = 90;
const STAGGER = 7; // frames between two badges
const FLASH_FRAMES = [2, 4];
const LIT_FROM = 5;
const GREY = "#4a5058";

// a hidden badge reveals nothing until it's won
const SECRET = { name: "???", desc: "a secret, keep playing" };
const display = (badge) => (badge.hidden && !badge.unlockedOn ? { ...badge, ...SECRET } : badge);
const WHITE = "#ffffff";

// where a fresh badge is in its little animation: "waiting" (still looks locked), "flash", or "lit"
function phaseOf(freshIndex, frame) {
  if (freshIndex < 0) return "lit";
  const local = frame - freshIndex * STAGGER;
  if (FLASH_FRAMES.includes(local)) return "flash";
  return local >= LIT_FROM ? "lit" : "waiting";
}

// Three columns of badges with a pixel-icon preview of the selected one. Badges in `fresh`
// (won since /badges was last opened) light up in order, and the preview follows them until
// a key is pressed. ↑/↓ walk a column, ←/→ jump between columns, esc closes.
export function Badges({ badges, fresh = [], onClose }) {
  const firstFresh = badges.findIndex((b) => b.id === fresh[0]);
  const [selected, setSelected] = useState(firstFresh >= 0 ? firstFresh : 0);
  const [following, setFollowing] = useState(fresh.length > 0);
  const [frame, setFrame] = useState(0);
  const rows = Math.ceil(badges.length / COLUMNS);
  const animationEnd = (fresh.length - 1) * STAGGER + LIT_FROM;

  useEffect(() => {
    if (!fresh.length) return undefined;
    const timer = setInterval(() => {
      setFrame((f) => {
        if (f >= animationEnd) clearInterval(timer);
        return f + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  // the preview jumps to each fresh badge as it starts to light up
  useEffect(() => {
    if (!following || frame % STAGGER !== 0) return;
    const index = badges.findIndex((b) => b.id === fresh[frame / STAGGER]);
    if (index >= 0) setSelected(index);
  }, [frame, following]);

  useInput((input, key) => {
    if (key.escape || input === "q") return onClose();
    setFollowing(false);
    if (key.upArrow) return setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSelected((s) => Math.min(badges.length - 1, s + 1));
    if (key.leftArrow) return setSelected((s) => Math.max(0, s - rows));
    if (key.rightArrow) return setSelected((s) => Math.min(badges.length - 1, s + rows));
  });

  const unlocked = badges.filter((b) => b.unlockedOn).length;
  const badge = display(badges[selected]);
  const phase = phaseOf(fresh.indexOf(badge.id), frame);
  const shownUnlocked = badge.unlockedOn && phase === "lit";

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.accent} paddingX=${2} width=${PANEL_WIDTH}>
        <${Box}>
          <${Text} bold color=${theme.accent}>Badges<//>
          <${Text} dimColor>  ${unlocked}/${badges.length}<//>
          ${fresh.length > 0 && html`<${Text} color=${theme.warn}>  ${fresh.length} new<//>`}
        <//>

        <${Box} marginTop=${1}>
          <${Box} flexDirection="column" width=${ICON_WIDTH + 3}>
            <${BadgeIcon} id=${badge.id} locked=${!badge.unlockedOn || phase === "waiting"} flash=${phase === "flash"} secret=${badge.hidden && !badge.unlockedOn} />
          <//>
          <${Box} flexDirection="column" justifyContent="center">
            <${Box}><${Text} bold color=${shownUnlocked ? badgeColor(badge.id) : undefined} dimColor=${!shownUnlocked}>${badge.name}<//><//>
            <${Box}><${Text}>${badge.desc}<//><//>
            <${Box}><${Text} dimColor>${badge.unlockedOn ? `unlocked ${badge.unlockedOn}` : "still locked"}<//><//>
          <//>
        <//>

        <${Box} marginTop=${1}>
          ${Array.from({ length: COLUMNS }, (_, column) => column).map(
            (column) => html`
              <${Box} key=${column} flexDirection="column" width=${COLUMN_WIDTH}>
                ${badges.slice(column * rows, column * rows + rows).map((b, r) => {
                  const index = column * rows + r;
                  const current = index === selected;
                  const rowPhase = phaseOf(fresh.indexOf(b.id), frame);
                  const shown = b.unlockedOn && rowPhase !== "waiting";
                  const dotColor = !shown ? undefined : rowPhase === "flash" ? WHITE : badgeColor(b.id);
                  const nameColor = current ? theme.accent : rowPhase === "flash" ? WHITE : shown ? theme.text : undefined;
                  return html`
                    <${Box} key=${b.id}>
                      <${Text} bold=${current} dimColor=${!current && !shown} wrap="truncate">
                        <${Text} color=${current ? theme.accent : undefined}>${current ? "❯" : " "} <//>
                        <${Text} color=${dotColor ?? (b.unlockedOn ? GREY : undefined)}>${shown ? "●" : "○"} <//>
                        <${Text} color=${nameColor}>${display(b).name}<//>
                      <//>
                    <//>
                  `;
                })}
              <//>
            `
          )}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text="↑/↓ browse · ←/→ column · esc back" /><//>
    <//>
  `;
}
