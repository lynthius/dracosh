# The README's demo: `vhs docs/demo/demo.tape` (from the repo root) writes docs/demo.gif.
# Needs VHS (brew install vhs). Runs on a throwaway /tmp/dracosh-demo, never on your own cards.

Output docs/demo.gif

Set Shell "zsh"
Set FontSize 18
Set Width 1000
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 90ms
Set CursorBlink false

Hide
Type "export DRACOSH_HOME=/tmp/dracosh-demo && node docs/demo/seed.mjs && alias dracosh='node --import ./docs/demo/steady.mjs src/cli.js' && clear"
Enter
Sleep 1s
Show

Type "dracosh"
Sleep 400ms
Enter
Sleep 2.5s

# an article left out still counts
Type "cat"
Sleep 300ms
Enter
Sleep 2.5s
Enter
Sleep 1.5s

# one typo on a longer word: close enough, with the letter shown
Type "tomorow"
Sleep 300ms
Enter
Sleep 3s
Enter
Sleep 1.5s

# a miss: the right answer, and where you went wrong
Type "the bookshop"
Sleep 300ms
Enter
Sleep 3s
Enter
Sleep 1.5s

# don't know? an empty Enter shows the answer, then grade yourself
Enter
Sleep 2s
Type "2"
Sleep 2.5s

# a new card, written in one line
Type "/add"
Sleep 500ms
Enter
Sleep 1.2s
Enter
Sleep 1s
Type "la playa = the beach // Vamos a la playa."
Sleep 600ms
Enter
Sleep 2.5s
Escape
Sleep 2.5s
