import { Fragment, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { html, KeyHints, theme, usePanelWidth } from "./kit.js";
import { Mascot } from "./Mascot.js";

const FRAME_MS = 120;
const FLASH_FROM = 6; // frames 0..5: the old form, wondering
const REVEAL_AT = 16; // frames 6..15: white-out flashing, then the new form
const SPARKS = ["✦", "·", "✧", "*"];

const article = (name) => (/^[aeiou]/i.test(name) ? "an" : "a");

// a loose ring of sparkles around the sprite; which ones show varies per frame
function sparkleRow(frame, seed, width) {
  const chars = [];
  for (let i = 0; i < width; i++) {
    chars.push((i * 7 + seed * 13 + frame * 3) % 11 === 0 ? SPARKS[(i + frame) % SPARKS.length] : " ");
  }
  return chars.join("");
}

// The full-screen moment when the companion evolves: old form → white flashes → new form.
// Any key fast-forwards to the reveal; Enter/Esc then closes it.
export function Evolution({ from, to, name, element = null, onClose }) {
  const panel = usePanelWidth();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  const revealed = frame >= REVEAL_AT;
  useInput(() => {
    if (!revealed) return setFrame(REVEAL_AT);
    onClose();
  });

  const flashing = frame >= FLASH_FROM && !revealed;
  const stage = revealed ? to : from;
  const sparks = flashing || (revealed && frame < REVEAL_AT + 8);

  return html`
    <${Fragment}>
      <${Box} flexDirection="column" borderStyle="round" borderColor=${theme.warn} paddingX=${2} paddingY=${1} width=${panel} alignItems="center">
        <${Text} bold color=${theme.warn}>✦ Evolution ✦<//>
        <${Box} flexDirection="column" marginTop=${1} alignItems="center">
          <${Text} color=${theme.warn}>${sparks ? sparkleRow(frame, 1, 30) : " "}<//>
          <${Mascot} stage=${stage} face=${revealed ? "happy" : "idle"} flash=${flashing && frame % 2 === 0} scale=${2} element=${element} />
          <${Text} color=${theme.warn}>${sparks ? sparkleRow(frame, 2, 30) : " "}<//>
        <//>
        <${Box} marginTop=${1} flexDirection="column" alignItems="center">
          ${revealed
            ? html`<${Text} bold color=${theme.accent}>Your companion evolved into ${article(name)} ${name}!<//>`
            : html`<${Text} dimColor>Something is happening…<//>`}
        <//>
      <//>
      <${Box} paddingX=${1}><${KeyHints} text=${revealed ? "enter continue" : "any key to hurry it up"} /><//>
    <//>
  `;
}
