#!/usr/bin/env node
// Generates the chiptune sound effects in assets/sounds/ (16-bit mono WAV, square waves).
// Run `npm run sounds` after changing anything here; the WAVs are committed so users never run this.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22050;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds");

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE((Math.max(-1, Math.min(1, s)) * 32767) | 0, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); // PCM header size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// One note. `decay` shapes the exponential fade; `slideTo` sweeps the pitch across the note.
function tone(freq, ms, { amp = 0.25, decay = 6, wave = "square", slideTo = null } = {}) {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = slideTo ? freq * Math.pow(slideTo / freq, t) : freq;
    phase += f / RATE;
    const s = wave === "square" ? (phase % 1 < 0.5 ? 1 : -1) : Math.sin(2 * Math.PI * phase);
    const attack = Math.min(1, i / 80); // a few ms of fade-in against clicks
    out[i] = s * amp * attack * Math.exp(-decay * t);
  }
  return out;
}

const seq = (...parts) => parts.flat();

// Rising pitch ladder for consecutive correct answers (C5 D5 E5 G5 A5 C6): the classic combo juice
export const LADDER = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

const sounds = {
  close: seq(tone(659.25, 70, { decay: 4 }), tone(622.25, 150, { decay: 8 })), // "almost": a step down
  wrong: seq(tone(311.13, 90, { decay: 3, amp: 0.2 }), tone(233.08, 220, { decay: 7, amp: 0.2 })),
  ask: tone(740, 60, { decay: 10, amp: 0.3, wave: "sine" }), // soft pop: a new word arrived
  goal: seq(tone(523.25, 70, { decay: 4 }), tone(659.25, 70, { decay: 4 }), tone(783.99, 70, { decay: 4 }), tone(1046.5, 260, { decay: 6 })),
  // badge unlocked: a quick run up (C E G C), a hop back, and a bell that rings out
  badge: seq(
    tone(1046.5, 65, { decay: 3, amp: 0.2 }),
    tone(1318.5, 65, { decay: 3, amp: 0.2 }),
    tone(1567.98, 65, { decay: 3, amp: 0.2 }),
    tone(2093, 120, { decay: 2, amp: 0.2 }),
    tone(1567.98, 70, { decay: 3, amp: 0.18 }),
    tone(2093, 420, { decay: 5, amp: 0.3, wave: "sine" })
  ),
  combo: seq(tone(783.99, 55, { decay: 4 }), tone(880, 55, { decay: 4 }), tone(1046.5, 170, { decay: 7 })),
  // evolution: a long power-up sweep, then a fanfare
  evolve: seq(
    tone(261.63, 350, { slideTo: 1046.5, decay: 1, amp: 0.18 }),
    tone(523.25, 80, { decay: 3 }),
    tone(783.99, 80, { decay: 3 }),
    tone(1046.5, 80, { decay: 3 }),
    tone(1318.5, 320, { decay: 5 })
  )
};
// more badges won with the same answer: a short bell each, climbing (G6, A6, C7)
[1567.98, 1760, 2093].forEach((f, i) => {
  sounds[`badge-${i + 2}`] = seq(tone(f, 40, { decay: 3, amp: 0.15 }), tone(f * 2, 220, { decay: 6, amp: 0.28, wave: "sine" }));
});
LADDER.forEach((f, i) => {
  sounds[`correct-${i}`] = seq(tone(f, 55, { decay: 3 }), tone((f * 4) / 3, 140, { decay: 7 }));
});

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) writeFileSync(path.join(OUT_DIR, `${name}.wav`), wav(samples));
console.log(`Wrote ${Object.keys(sounds).length} sounds to ${OUT_DIR}`);
