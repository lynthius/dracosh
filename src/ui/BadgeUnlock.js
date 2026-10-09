import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { badgeColor } from "./icons.js";
import { html, theme } from "./kit.js";

const FRAME_MS = 90;
const FLASH_FRAMES = [5, 7]; // white-out frames before the name lights up in its rank color
const COLOR_FROM = 8;
const SPARKS_UNTIL = 22;
const SPARKS = ["✦", "·", "✧", "·"];
const GREY = "#4a5058";
const WHITE = "#ffffff";

// A badge just won, as one line under the card: the name comes out of grey, flashes white and
// lights up in its rank color while a few sparks fly. The badge art lives in /badges.
// `delay` staggers several badges won at once.
export function BadgeUnlock({ id, name, desc, delay = 0 }) {
  const [frame, setFrame] = useState(-Math.round(delay / FRAME_MS));
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => {
        if (f >= SPARKS_UNTIL) clearInterval(timer);
        return f + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  if (frame < 0) return null;
  const color = FLASH_FRAMES.includes(frame) ? WHITE : frame >= COLOR_FROM ? badgeColor(id) : GREY;
  const sparks = frame < SPARKS_UNTIL ? `  ${Array.from({ length: 3 }, (_, i) => SPARKS[(frame + i) % SPARKS.length]).join(" ")}` : "";

  return html`
    <${Box}>
      <${Text} color=${color}>✦ <//>
      <${Text} color=${theme.warn}>Badge unlocked: <//>
      <${Text} bold color=${color}>${name}<//>
      <${Text} dimColor> · ${desc}<//>
      <${Text} color=${theme.warn}>${sparks}<//>
    <//>
  `;
}
