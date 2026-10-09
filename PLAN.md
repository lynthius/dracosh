# Roadmap

Mission: a vocabulary and quiz trainer for the terminal that anyone can install and enjoy in a
minute. It walks you through setup, works with any popular language pair and with any kind of
deck (words, term and definition, question and answer), and moves cards freely to and from
Anki. A pixel dragon grows with your progress. macOS first, then Linux and Windows.

## How we work

- One stage at a time, in the order below. Each stage has its own branch, ends with a pull
  request into `main`, and usually with an npm release.
- A stage is done when everything in its "Done when" list is true: tests pass, README and this
  file are updated, and the feature has been tried in the real app or in `dracosh --preview`.
- Anything not in this plan gets added here first, then built. No improvising mid-stage.
- `main` is always stable. Small fixes (typos, docs) can go straight to `main`.

## Decisions

Stack (kept as is)
- Plain JavaScript (ES modules) on Node, no build step: clone, `npm install`, run.
- UI: [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) with `htm` templates
  instead of JSX, which is what keeps the build step away.
- Storage: JSON files in `~/.dracosh`, written atomically, with a schema version and migrations.
  Plenty for tens of thousands of cards; revisit SQLite (`node:sqlite`) only if it ever isn't.
- Few dependencies (today: ink, react, htm). AI providers are called with plain `fetch`, no SDKs.
- Type safety without a build: JSDoc types checked by `tsc --checkJs` in CI (dev-only).
- The app's UI comes in English, Polish, German, French and Ukrainian. Every text lives under a
  key in one file per language (`locales/<lang>.json`), English is the fallback for anything
  missing, and native speakers can improve a translation with a pull request. Grammar tips stay
  in English; they are about English.

Product (decided 2026-10-09)
- Dracosh keeps its own card library. Anki is an import source and an export target; it never
  has to be running.
- Three card types: translation (word and its translations), definition (term and definition),
  Q&A (question and answer).
- Two answer modes, set per deck: typed (the app checks your answer, shows the letter diff) and
  self-graded (reveal the answer, say whether you knew it). Translation and definition decks
  default to typed, Q&A decks to self-graded. For definition decks the typed answer is always
  the term.
- Languages: full answer checking for European languages in Latin script and Cyrillic (EN, ES,
  FR, DE, IT, PT, PL, NL, SV, DA, NO, FI, CS, SK, HU, RO, HR, TR, UK, RU and similar). Chinese,
  Japanese and Korean display and can be typed, without special handling. Right-to-left
  scripts (Arabic, Hebrew) later; terminals render them poorly.
- AI is optional, and the user brings their own: an Anthropic API key, or any OpenAI-compatible
  endpoint, which covers OpenAI, OpenRouter, Groq and local models through Ollama and LM Studio.
- First run: a "Getting started" deck (a few arithmetic cards plus cards about Dracosh itself,
  so it works in any language), import a file, start an empty deck, or (with AI set up)
  generate a starter deck for any pair.
- Two study rhythms, chosen in settings: "every few minutes" (the default, for working in a
  spare pane) and "session" (the next card right after you answer).

UX and data (decided 2026-10-09)
- Simple by default. The quiz screen stays calm; everything else lives behind `/` commands and
  settings. A new feature earns a place on the main screen only if most people need it.
- Your data is yours and stays put: uninstalling Dracosh never touches `~/.dracosh`, so
  reinstalling brings everything back. `dracosh --data` shows where it lives.
- Nothing is lost by accident: automatic backups, confirmations that say what will be removed
  ("Delete deck Spanish and its 340 cards?"), an undo key right after deleting, and a trash
  that keeps deleted decks and cards (with their progress) for 30 days.

## Status

- [x] 0.1.0 on npm (2026-10-09): quiz from a live Anki deck through AnkiConnect, EN ↔ PL
- [x] Pixel dragon (hatching, six forms, evolution ceremony, moods, blinking, sleeping),
      chiptune sounds, streaks, badges, stats calendar, `--preview` gallery
- [x] Anki notes are read by field position, so any Anki language and note type works
- [x] License: Apache-2.0, name and mascot reserved (NOTICE)

## Stage 1: Card library (0.2.0)

Branch `feature/card-library`. Dracosh stops reading Anki live and quizzes from its own library.

- [x] Library file `~/.dracosh/library.json` with a schema version:
      decks `{ id, name, type, languages: { front, back }, answerMode, directions }` and
      cards `{ id, deckId, front, back[], example, tags, created, updated, ankiNoteId? }`
- [ ] The quiz reads the active deck (or all decks) from the library
- [ ] Progress keyed by card id; cards that came from Anki keep their Anki note id, so their
      progress survives a re-import
- [ ] Bundled "Getting started" deck: a few arithmetic cards (`2 + 2`, `6 × 7`) and cards
      about Dracosh itself (`Which key opens the commands?` → `/`)
- [ ] Automatic backups of the library and progress to `~/.dracosh/backups/`: once a day on
      start, and right before a migration, import, deletion or reset. The last 7 daily backups
      are kept; `dracosh restore` lists them and brings one back
- [ ] `dracosh --data` prints where everything is stored
- [ ] `dracosh add "word" "translation"` to add a card from any terminal, also while the quiz
      runs in another pane: the library is re-read before each question, so new cards show up
      without a restart
- [ ] `--deck` picks a library deck; live AnkiConnect reading is removed. No migration from
      0.1.0 (it had no users besides the author); Anki decks come in through import in stage 4

Done when: a fresh install quizzes the "Getting started" deck with no Anki; backups are written
and restorable; tests cover the library, backups and progress mapping.

## Stage 2: Card types and answer modes (0.3.0)

Branch `feature/card-types`.

- [ ] UI text groundwork, first, before new screens are built: a `t("key")` helper,
      `locales/en.json` with every existing UI string, plural rules through the built-in
      `Intl.PluralRules` (Polish and Ukrainian have three plural forms)
- [ ] Card types translation, definition and Q&A in the model and the quiz screen
- [ ] Typed mode as today; for definition decks the definition is shown and the term is typed
- [ ] Self-graded mode: show the question, reveal on Enter, then "knew it" / "didn't";
      it feeds the same Leitner boxes, goal, combo and badges
- [ ] Per-deck default answer mode, switchable in deck settings
- [ ] Study rhythm in settings: "every few minutes" or "session" (next card right away,
      optionally a set number of cards); the setting sticks until changed
- [ ] `--preview` shows a definition card and a self-graded card

Done when: all three types can be quizzed in both modes, and scoring stays consistent.

## Stage 3: Language pairs (0.4.0)

Branch `feature/languages`.

- [ ] Each deck has a front and back language (ISO codes); direction labels come from them
      instead of the hardcoded EN → PL
- [ ] Answer checking: diacritic folding for the supported languages, plus the letters that
      don't fold on their own (ł, ø, ß, đ, æ, œ, ı, ё and others), with tests per language
- [ ] Grammar tips become packs: the current one is `en-for-pl`; tips only show when a pack
      matches the deck's languages
- [ ] Pronunciation (optional, in settings): the word is spoken after the answer with a voice
      for the deck's language; macOS `say` first, other systems in stage 7
- [ ] UI copy audited for EN/PL assumptions

Done when: a deck in any supported pair quizzes correctly both ways, with fair answer checking.

## Stage 4: Import and export (0.5.0)

Branch `feature/import-export`. Moving cards between Dracosh and Anki in both directions.

Import (`dracosh import <file>`, or from the app)
- [ ] `.txt` / `.tsv`: Anki's "Notes in Plain Text" export (tab-separated, first field = front,
      HTML inside fields); `#separator`, `#html`, `#deck`, `#columns` headers honoured when present
- [ ] `.csv`: `front,back,example` with an optional header row
- [ ] `.apkg` / `.colpkg`: decks shared on AnkiWeb (a zip with an SQLite collection inside,
      `collection.anki21b` is zstd-compressed). Media is skipped
- [ ] Paste: copy rows from Quizlet's export, Google Sheets, Excel or any list and paste them
      in (or `dracosh import --clipboard`). The separator is detected (tab, comma, semicolon,
      ` - `, ` = `), and a preview of the first rows split into columns must be confirmed
      before anything is saved. Tested with real exports from each of those sources
- [ ] `dracosh import --anki ["Deck"]`: one-time copy from a running Anki through AnkiConnect,
      with a deck picker
- [ ] On import: pick or create the target deck, guess the card type, confirm the languages;
      duplicates are merged; a summary shows what was added, updated and skipped

Export (`dracosh export <file>`, or from the app)
- [ ] `.txt`: Anki-ready, with `#separator:Tab`, `#html:true`, `#notetype:Basic`, `#deck:<name>`
      headers, so File → Import in Anki (2.1.54+) needs no setup
- [ ] `.csv` for spreadsheets
- [ ] `.json`: a full backup of the library and progress, restorable with `dracosh import`
- [ ] Not planned: writing `.apkg` (Anki's internal schema is complex and changes between
      versions; plain text covers the same need)
- [ ] Set the minimum Node version to what zstd and `node:sqlite` need without flags

Done when: an AnkiWeb deck imports and quizzes; a Dracosh deck exported to `.txt` imports into
Anki unchanged; a JSON backup restores everything.

## Stage 5: Welcome flow and deck management (0.6.0)

Branch `feature/onboarding`. Everything a new user needs, without reading the README.

- [ ] First run, after the hatching: choose the app's language, the language you speak and the
      one you're learning
- [ ] UI translations: Polish, German, French and Ukrainian (`locales/*.json`), each marked as
      open for corrections; a short "Help translate" note in the README
- [ ] `/settings`: app language
- [ ] Then: start with a demo deck, import a file, or create an empty deck
- [ ] Short interactive tour of the quiz screen (answer, `/` commands, the dragon); skippable
- [ ] `--preview` plays the whole welcome flow on made-up data
- [ ] `/decks`: list, create, rename, delete, pick the active deck, deck settings (type,
      languages, answer mode, directions)
- [ ] `/cards`: browse and search the active deck, add, edit and delete cards
- [ ] Adding a card is the most-used flow and must feel effortless: `/add`, type or paste a
      phrase, see the card preview, Enter saves, Tab edits a field, Esc cancels. Same flow from
      the shell with `dracosh add`. Warns about duplicates
- [ ] Deleting decks and cards as decided above: confirmation with counts, undo key, trash
      (`/trash` to restore); also moving cards between decks and merging decks
- [ ] `dracosh reset` removes all data after a confirmation, offering an export first
- [ ] README: a short "Your data" section (where it lives, backups, uninstalling keeps it)

Done when: someone who has never seen Dracosh installs it and reaches their first question
without help, can manage decks and cards entirely in the app, and can't lose data by accident.

## Stage 6: AI assistance (0.7.0)

Branch `feature/ai`. Optional; everything works without it.

- [ ] Settings: provider (Anthropic, or OpenAI-compatible with a base URL), model and API key;
      key from an environment variable or stored in `~/.dracosh` with owner-only permissions,
      never logged or exported
- [ ] Presets for OpenAI, OpenRouter, Ollama (`http://localhost:11434/v1`) and LM Studio
      (`http://localhost:1234/v1`)
- [ ] `/add <word>`: suggests translations, an example sentence and alternatives for the deck's
      languages; you accept, edit or reject before anything is saved
- [ ] Help for definition and Q&A cards: suggest a definition, rephrase a question, check a card
- [ ] With AI, adding a card takes two keys: paste a phrase, the translation and an example
      appear in the preview, Enter saves
- [ ] Generate a starter deck for any pair (offered in the welcome flow when AI is set up)
- [ ] Natural voices (optional): pronunciation through the user's ElevenLabs or OpenAI key
      instead of the system voice. Each card's audio is generated once and cached in
      `~/.dracosh/audio`, so cost is per new card, not per review
- [ ] Clear errors for a missing key, an unreachable local model or rate limits; costs stay
      visible (small default models)

Done when: the same `/add` flow works with an Anthropic key and with a local Ollama model, and
a pasted phrase becomes a saved card in a few seconds.

## Stage 7: Linux and Windows (0.8.0)

Branch `feature/cross-platform`. macOS stays the reference.

- [ ] Sounds: `afplay` (macOS), `paplay` / `aplay` / `ffplay` (Linux), PowerShell `SoundPlayer`
      (Windows); silent if none is available
- [ ] Notifications: `osascript` (macOS), `notify-send` (Linux), terminal bell on Windows
      (native toasts later, if wanted)
- [ ] Check rendering in common terminals: iTerm2, Terminal.app, GNOME Terminal, Alacritty,
      kitty, Windows Terminal
- [ ] Pronunciation on Linux (`espeak-ng`) and Windows (built-in speech through PowerShell)
- [ ] `dracosh doctor`: checks Node, the sound player, speech, the data folder and the AI
      connection, and says what to fix
- [ ] `dracosh bug`: opens a GitHub issue prefilled with the version, OS, Node, terminal and
      the doctor's report (never cards or personal data); plus an issue template on GitHub
- [ ] CI matrix: macOS, Ubuntu, Windows

Done when: CI is green on all three systems and the quiz plays sounds on each.

## Stage 8: 1.0

Branch `release/1.0`.

- [ ] README: hero GIF (recorded with `vhs`), quickstart (`npx dracosh`), screenshots
- [ ] GitHub Actions: tests and type checks on every push and PR
- [ ] Panels shrink gracefully on narrow terminals
- [ ] Vision setting: a colorblind-friendly mode (wrong letters underlined, not only red) and a
      high-contrast palette
- [ ] New version notice: at most once a day, a quiet line on start when npm has a newer
      version; can be turned off
- [ ] macOS notifications with the mascot as the icon (PNG generated from the sprite grid)
- [ ] CONTRIBUTING.md, `good first issue` labels, issue templates
- [ ] "Dracosh™" in the README header

## Known issues

UI bugs found along the way. Fixed on `main` if they affect the released version, otherwise on
the current stage's branch.

- (none listed yet)

## Later

Good ideas with no stage yet. They move into a stage only by a plan change.

- FSRS scheduling (the algorithm modern Anki uses) as an alternative to Leitner boxes
- Import from Kindle Vocabulary Builder (`vocab.db`: words with the sentence you met them in;
  translations filled in by AI)
- Markdown flashcards (`front :: back`, as used by Obsidian spaced-repetition plugins)
- Homebrew install (`brew install dracosh`)
- Voice answers: say the answer instead of typing it (speech-to-text through a local Whisper
  model or the user's API key), which also makes it pronunciation practice

## Brand protection

Apache-2.0 for the code; the name and mascot are reserved (NOTICE, README). A license never
stops forks; what keeps the community here is being the active original.

- [x] Claim the npm name `dracosh`
- [ ] Register the domain `dracosh.com`
- [ ] Later, if the project takes off: register the trademark (UPRP for Poland, or EUIPO for the
      whole EU), class 9 (software); check the EUIPO SME Fund for a fee refund first
- [ ] Community: quick replies to issues and PRs

## Notes

- Repo: `lynthius/dracosh`. The GitHub username `dracosh` is taken by a dormant 2012 account.
- Naming neighbour: `dbuzatto/dracoshell` (a tiling terminal, 2026).
