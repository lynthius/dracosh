# Dracosh

A gamified language or definitions trainer for your terminal. It sits in a spare pane, challenges you every few minutes, and a small pixel dragon grows up as you keep your streak going.

## Why Dracosh

Learning a language usually means another hour in the evening, after a full day at the computer. I spent plenty of those evenings myself, and I wanted something that fits into the working day instead.

The day is full of short waits: a build that takes a minute, tests running, an AI agent finishing a task for you. Dracosh turns those moments into practice. Instead of reaching for your phone, you answer a word or two, the dragon cheers, and you're back to work. A few minutes here and there add up, and your evenings stay yours.

It's made for people who live in a terminal or spend most of the day at a computer, and it's meant to be fun, not one more chore.

## Features

- Your cards live in Dracosh's own library, organised in decks; no other app needs to be running
- Add cards, start decks and switch between them right in the app (`/add`, `/decks`)
- One line is a card: `kot = cat; kitty // Mój kot śpi.` (`;` separates right answers, `//` adds an example). Paste a whole list and check it before it's saved
- Each deck is asked the way you pick after its first card: front → back, back → front, or both ways; change it any time in `/decks`
- Dracosh works out which languages a deck is in from its cards, its name and the language you use it in (Spanish → Polish, say), and tells you when it has a guess; when it can't tell or guesses wrong, set them in `/decks`
- Type the answer, or press Enter with nothing typed to see it and say whether you knew it (`1` or `2`): handy for whole sentences, and it counts just the same
- Cloze cards for sentences: `I {{look forward}} to it` asks one gap at a time
- Forgiving answer checks: case and punctuation don't matter, a missing accent or special letter (ż, ł, é, ß, ø…) still counts and the right spelling is shown with it marked, German "Baer" for "Bär" and Danish "aa" for "å" count too, an article can be left out ("cat" for "the cat", "Hund" for "der Hund"; the wrong one shows as close), one typo is fine on longer words, and after a miss you see letter by letter where you went wrong. Chinese, Japanese and Korean answers are checked exactly
- Leitner boxes, so the cards you know come back less and less often; a card is only asked when it's due
- Daily goal, streaks (weekends and days off don't break them) and 36 badges (one of them a secret)
- A pixel dragon that hatches from an egg, evolves over a year of streaks, blinks, and falls asleep if you ignore it
- 8-bit sound effects, generated from code
- Now and then, a short tip about Dracosh while you wait for the next card
- Speaks English, Polish, German, French and Ukrainian: it follows your system's language, and `/settings` switches it

## Install

You need Node 22 or newer.

```bash
npm install -g dracosh
```

A fresh install starts with a short "Getting started" deck, in the app's language: a tour where every card tells you what to type and shows you one more thing Dracosh can do. When you're through, `/add` starts your own deck and the tour makes room for it. Importing decks (from Anki, CSV and more) is on the way, see [What's next](#whats-next).

Want a look first? `dracosh --preview` shows every screen and animation on made-up data.

## Usage

```bash
dracosh --deck "Polish"    # quiz this deck, this run only (otherwise the one picked in /decks)
dracosh --every 5m         # a card every 5 minutes instead of 10, this run only
dracosh --no-sound
dracosh --stats            # print your progress and exit
dracosh --data             # show where your cards, progress and backups are kept
dracosh --preview
dracosh restore            # list your backups; dracosh restore 2 brings one back
```

Type the answer and press Enter. Not sure, or the answer is a whole sentence? Press Enter with nothing typed: the answer shows up, then press `1` if you didn't know it or `2` if you did. Press `/` for commands:

| Command | What it does |
| --- | --- |
| `/add` | add cards to one of your decks, or start a new deck (one line per card, ↑ fixes the last one) |
| `/decks` | switch to another deck (Dracosh remembers it), start a new one, or press → to change how a deck is asked and which languages it's in |
| `/hint` | reveal one more letter |
| `/correct` | your answer was right after all; after a yes it's accepted from now on |
| `/settings` | language, rhythm (a card every few minutes, or a study session), interval, daily goal, sound, quiet hours, weekends, tips, and a reset |
| `/stats` | streak and a calendar of your month |
| `/badges` | all badges and how to get them |
| `/companion` | your dragon, its element and the forms ahead |
| `/missed` | cards you got wrong today |
| `/pause 30m` | a break: `30m`, `2h`; or days off that keep your streak: `3d`, `24.12 2.01`; `off` ends it |
| `/help` | the keys, how cards come back, the streak |
| `/quit` | quit (you'll get a short session summary) |

They're slash commands because "pause" and "quit" are perfectly good English answers.

## Your data

Everything stays on your machine, in `~/.dracosh`; `dracosh --data` shows what's there. Progress is saved after every answer, so you can quit any time. One quiz runs at a time: a second window on the same data is refused, so the two can't overwrite each other's progress. The first start of each day also saves a backup of your cards, progress and settings to `~/.dracosh/backups` (the last 7 are kept); `dracosh restore` brings one back, and backs up what you have first, so a restore can be undone too. To start over, `/settings` → Reset clears your progress only (badges, streak, the dragon) or everything; a backup is made first. To use Dracosh on two computers, put that folder somewhere synced and point `DRACOSH_HOME` at it.

Sounds currently play on macOS only.

## Development

```bash
git clone https://github.com/lynthius/dracosh.git
cd dracosh
npm install
npm link          # puts `dracosh` on your PATH
npm test
```

The quiz logic in `src/session.js` and `src/progress.js` does no I/O, which keeps it easy to test. The UI is built with [Ink](https://github.com/vadimdemedes/ink) and lives in `src/ui/`; every text it shows is in `locales/en.json`, read through `t("key")` from `src/i18n.js`.

The other languages live next to it in `locales/`, the tour included. `npm test` checks that each one has every English key, the same `{placeholders}` and all the plural forms its language needs. If you're a native speaker and something reads oddly, a pull request is very welcome. Sound effects are generated by `scripts/make-sounds.js` (`npm run sounds`).

## What's next

Dracosh now keeps its own card library, with a short tour and `/add` to start your own deck. Coming next, roughly in this order:

- More languages for your decks: answer checking that forgives a missing accent in European languages and Cyrillic (other scripts are checked exactly).
- Import and export: Anki (plain-text exports and `.apkg` decks from AnkiWeb), CSV, JSON and pasted lists, and export back to Anki.
- Decks and cards in the app: browse, edit and delete with undo, plus a welcome flow for new users.
- Optional AI help for writing cards, with your own API key or a local model.
- Linux and Windows.

## License

The code is licensed under [Apache 2.0](LICENSE), so feel free to use it, change it and build on it. The name "Dracosh" and the dragon mascot aren't covered by the license, so forks need their own name. See [NOTICE](NOTICE).

Contributions are welcome!
