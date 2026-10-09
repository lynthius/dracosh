# Roadmap

Where Dracosh is headed: a polished vocabulary trainer for the terminal that works
for anyone, not just Anki users learning English from Polish. Clean architecture,
tests, CI and a good README along the way.

## Status

- [x] Cloned from the private `anki-quiz` project and rebranded (name, `~/.dracosh`, `DRACOSH_HOME`)
- [x] Own visual identity: violet accent, green pixel dragon, gold combo fire, `❯` prompt, pixel spinner
- [x] `/stats` calendar: even month grid, one tile per day, color-only states
- [x] First-launch intro: the dragon hatches from an egg (`src/ui/Hatch.js`)
- [x] `dracosh --preview`: a gallery of every scene/animation on made-up data (`src/ui/Preview.js`)
- [x] Random natural blinking (2.5–7 s gaps, occasional double blink)
- [x] Falls asleep after 3 idle minutes (z's drifting up), wakes on any key
- [x] License: Apache-2.0 (code), with the name and mascot reserved as trademarks in NOTICE/README

## Phase 0: Housekeeping

- [x] Local git repository, `.gitignore`
- [x] `LICENSE` (Apache-2.0) and `NOTICE`
- [x] `package.json`: `author`, `repository`, `homepage`, `bugs`, `keywords`
- [x] `package.json`: `license` field
- [x] Package ready for npm: version 0.1.0, `files` whitelist, no `"private"`
- [ ] Publish 0.1.0 to npm to claim the `dracosh` name
- [ ] Panels narrower than `PANEL_WIDTH` should shrink on small terminals (today only the question card does)
- [ ] JSDoc type annotations + `tsc --checkJs` in CI: type safety without a build step; the runtime stays pure JS

## Phase 1: Word sources (works without Anki)

The single biggest adoption blocker is requiring Anki + AnkiConnect. Make sources pluggable:

- [ ] Source interface: `loadWords()` provider chosen by settings/flags
- [ ] **File source**: CSV/JSON (`word,translation,example`) in `~/.dracosh/words.csv` or `--words <file>`
- [ ] **Bundled demo deck** so `npx dracosh` works out of the box with zero setup
- [ ] **AnkiConnect source**: what we have today, kept as an option
- [ ] **`.apkg` import**: an Anki deck file is a zip with SQLite inside, readable with built-in `node:sqlite` (Node 22+), no Anki needed
- [ ] `/add` command appending to the file source (manual translation for now; AI in Phase 4)

## Phase 2: Cross-platform

- [ ] Sound player fallback: `afplay` (macOS) → `paplay`/`aplay`/`ffplay` (Linux); the chiptune WAVs stay as they are
- [ ] Notifications: `osascript` (macOS) → `notify-send` (Linux)
- [ ] Verify rendering on common terminals (iTerm2, Terminal.app, GNOME Terminal, Alacritty, kitty)
- [ ] CI matrix: macOS + Ubuntu (`node --test`)

## Phase 3: Generic language pairs

- [ ] Language pair in settings (labels for directions instead of hardcoded EN/PL)
- [ ] `judge.js`: NFD folding is nearly generic already; extend the hand-mapped set (`ł` → also `ø`, `ß`, `đ`, …)
- [ ] Tips as swappable packs; the current pack becomes `tips-en-for-pl`, structure open for community packs
- [ ] Notification/UI copy audited for EN/PL assumptions

## Phase 4: AI-assisted cards

- [ ] `/add <word>`: AI returns translation (for the configured pair) + example sentence + alternates; user confirms/edits before saving
- [ ] BYO key (`ANTHROPIC_API_KEY`), Claude Haiku for cost; without a key `/add` falls back to manual entry
- [ ] Same card format as the browser-extension pipeline, so both entry points feed one deck

## Phase 5: Release polish

- [ ] README rewrite: hero GIF (recorded with `vhs`), features, quickstart (`npx dracosh`), architecture notes
- [ ] npm publish (`dracosh`)
- [ ] GitHub Actions: tests on push/PR
- [ ] macOS notification icon = the mascot: PNG generated from the sprite grid (current evolution stage) via `terminal-notifier -contentImage`; optionally a rebranded app bundle with a mascot `.icns` for the app icon itself
- [ ] CONTRIBUTING.md (short), issue templates (optional)

## Brand protection

Decided: Apache-2.0 for the code; the name and mascot are reserved as trademarks (NOTICE, README).
A license never stops forks; what keeps the community here is being the active original.

- [ ] Claim the npm name `dracosh` with an early real release (free)
- [ ] Use "Dracosh™" in the README header once public (™ needs no registration; ® does)
- [ ] Optional, cheap: register the domain `dracosh.com` (free as of 2026-10-09)
- [ ] Later, if the project takes off: register the trademark (UPRP for Poland, or EUIPO for the
      whole EU), class 9 (software); check the EUIPO SME Fund for a fee refund first
- [ ] Community: CONTRIBUTING.md, `good first issue` labels, quick replies to issues and PRs

## Open questions

- **Repo name/handle**: `lynthius/dracosh`.
  The GitHub username `dracosh` itself is taken by a dormant 2012 account, so no `dracosh` org.
- **Naming neighbour**: `dbuzatto/dracoshell` (a tiling terminal, 2026) is the closest name in
  the same space; different name, but worth knowing about.
