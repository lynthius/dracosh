# Roadmap

Where Dracosh is headed: a vocabulary trainer for the terminal that works for anyone, out of
the box. Dracosh keeps its own card library; Anki becomes something you can import from and
export to, not something that has to be running. Clean architecture, tests, CI and a good
README along the way.

## Status

- [x] Cloned from the private `anki-quiz` project and rebranded (name, `~/.dracosh`, `DRACOSH_HOME`)
- [x] Own visual identity: violet accent, green pixel dragon, gold combo fire, `❯` prompt, pixel spinner
- [x] `/stats` calendar: even month grid, one tile per day, color-only states
- [x] First-launch intro: the dragon hatches from an egg (`src/ui/Hatch.js`)
- [x] `dracosh --preview`: a gallery of every scene/animation on made-up data (`src/ui/Preview.js`)
- [x] Random natural blinking (2.5–7 s gaps, occasional double blink)
- [x] Falls asleep after 3 idle minutes (z's drifting up), wakes on any key
- [x] License: Apache-2.0 (code), with the name and mascot reserved as trademarks in NOTICE/README
- [x] Anki notes are read by field position, so any Anki language and note type works
- [x] 0.1.0 published on npm (2026-10-09); words still come live from AnkiConnect

## Phase 0: Housekeeping

- [x] Local git repository, `.gitignore`
- [x] `LICENSE` (Apache-2.0) and `NOTICE`
- [x] `package.json`: `author`, `repository`, `homepage`, `bugs`, `keywords`, `license`
- [x] Package ready for npm: `files` whitelist, no `"private"`
- [x] Publish 0.1.0 to npm to claim the `dracosh` name
- [ ] Panels narrower than `PANEL_WIDTH` should shrink on small terminals (today only the question card does)
- [ ] JSDoc type annotations + `tsc --checkJs` in CI: type safety without a build step; the runtime stays pure JS

## Phase 1: Own card library, with import and export

Requiring a running Anki with AnkiConnect is the biggest adoption blocker. Dracosh gets its own
library; Anki stays fully interoperable through files.

The library
- [ ] Card store in `~/.dracosh/cards.json`: `{ id, front, back[], example, deck, tags, created }`,
      several decks in one library; the quiz runs on one deck or all of them
- [ ] The quiz reads the library instead of AnkiConnect (`loadWords` becomes a library read)
- [ ] Progress stays keyed by card id; cards imported from Anki keep their Anki note id,
      so re-importing the same deck doesn't reset progress
- [ ] Bundled demo deck, so `npx dracosh` works with zero setup
- [ ] First run, after the hatching: start with the demo deck, import a file, or add cards yourself
- [ ] Manage cards in the app: `/add`, plus a `/cards` browser to search, edit and delete
- [ ] Also from the shell: `dracosh add "word" "translation"`

Import (`dracosh import <file>`, format picked by extension)
- [ ] `.txt` / `.tsv`: Anki's "Notes in Plain Text" export (tab-separated, first field = front,
      HTML inside fields). `#separator`, `#html`, `#deck`, `#columns` headers honoured when present
- [ ] `.csv`: `front,back,example` with an optional header row, for spreadsheets and other apps
- [ ] `.apkg` / `.colpkg`: decks shared on AnkiWeb. A zip with an SQLite collection inside
      (`collection.anki21b` is zstd-compressed); both are built into recent Node. Zip reading
      needs `fflate` or a small own reader. Media is skipped
- [ ] One-time copy from a running Anki: `dracosh import --anki "Deck name"` (AnkiConnect,
      picker if no name is given)
- [ ] Duplicates (same front in the same deck) are merged, not doubled; a summary says what
      was added, updated and skipped

Export (`dracosh export <file>`)
- [ ] `.txt`: Anki-ready plain text with `#separator:Tab`, `#html:true`, `#notetype:Basic`,
      `#deck:<name>` headers, so File → Import in Anki (2.1.54+) needs no setup
- [ ] `.csv`: for spreadsheets
- [ ] `.json`: full backup of cards and progress, restorable with `dracosh import`
- [ ] Not planned for now: writing `.apkg` (Anki's internal schema is complex and changes
      between versions; plain text covers the same need)

Migration and cleanup
- [ ] Users of 0.1.0: on first start, offer to import the deck they used (`--deck`) from Anki,
      or from the cached `words.json` when Anki is closed
- [ ] Live AnkiConnect reading goes away; `--deck` selects a deck of the library instead
- [ ] Set the minimum Node version to what zstd + `node:sqlite` need without flags (verify;
      likely Node 24 LTS)

Definition cards
- [ ] Card type "definition": shows the definition, you type the term (judging free-text
      definitions isn't reliable, so the answer is always the term)
- [ ] Import keeps definition cards instead of skipping them

## Phase 2: AI-assisted cards

With its own library, Dracosh needs a fast way to add cards; typing translations by hand
isn't it.

- [ ] `/add <word>`: AI returns a translation for the configured language pair, an example
      sentence and alternatives; you confirm or edit before it's saved
- [ ] Bring your own key (`ANTHROPIC_API_KEY`, Claude Haiku for cost); without a key, `/add`
      asks for the translation manually
- [ ] Same card format as the browser-extension pipeline, so both can feed one library

## Phase 3: Generic language pairs

- [ ] Language pair in settings (direction labels instead of hardcoded EN/PL); imported decks
      can be in any language
- [ ] `judge.js`: NFD folding is nearly generic already; extend the hand-mapped set
      (`ł`, plus `ø`, `ß`, `đ`, …)
- [ ] Tips as swappable packs; the current pack becomes `tips-en-for-pl`, open for community packs
- [ ] UI copy audited for EN/PL assumptions

## Phase 4: Cross-platform

- [ ] Sound player fallback: `afplay` (macOS) → `paplay`/`aplay`/`ffplay` (Linux); the chiptune
      WAVs stay as they are
- [ ] Notifications: `osascript` (macOS) → `notify-send` (Linux)
- [ ] Verify rendering on common terminals (iTerm2, Terminal.app, GNOME Terminal, Alacritty, kitty)
- [ ] CI matrix: macOS + Ubuntu (`node --test`)

## Phase 5: Release polish

- [ ] README: hero GIF (recorded with `vhs`), quickstart (`npx dracosh`), short architecture notes
- [ ] GitHub Actions: tests on push and PR
- [ ] macOS notification icon = the mascot: PNG generated from the sprite grid (current evolution
      stage) via `terminal-notifier -contentImage`; optionally an app bundle with a mascot `.icns`
- [ ] CONTRIBUTING.md (short), issue templates (optional)

## Brand protection

Decided: Apache-2.0 for the code; the name and mascot are reserved as trademarks (NOTICE, README).
A license never stops forks; what keeps the community here is being the active original.

- [x] Claim the npm name `dracosh` with an early real release
- [ ] Use "Dracosh™" in the README header (™ needs no registration; ® does)
- [ ] Register the domain `dracosh.com`
- [ ] Later, if the project takes off: register the trademark (UPRP for Poland, or EUIPO for the
      whole EU), class 9 (software); check the EUIPO SME Fund for a fee refund first
- [ ] Community: CONTRIBUTING.md, `good first issue` labels, quick replies to issues and PRs

## Open questions

- **Repo name/handle**: `lynthius/dracosh`.
  The GitHub username `dracosh` itself is taken by a dormant 2012 account, so no `dracosh` org.
- **Naming neighbour**: `dbuzatto/dracoshell` (a tiling terminal, 2026) is the closest name in
  the same space; different name, but worth knowing about.
