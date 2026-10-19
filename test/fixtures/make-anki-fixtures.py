# Makes the Anki packages test/apkg.test.js reads, with Anki's own engine (the `anki` Python package):
#
#   python3 -m venv /tmp/anki && /tmp/anki/bin/pip install anki
#   /tmp/anki/bin/python test/fixtures/make-anki-fixtures.py test/fixtures
#
# anki-modern.apkg  what Anki writes today: collection.anki21b (zstd, schema 18), with scheduling,
#                   so a card in a filtered deck still says which deck it came from
# anki-legacy.apkg  "Support older Anki versions": collection.anki21 (schema 11), without scheduling,
#                   so Anki turns the filtered deck into a plain one
import os
import sys
import tempfile

from anki import lang
from anki.collection import Collection, ExportAnkiPackageOptions

out = sys.argv[1]
lang.set_lang("en")
col = Collection(os.path.join(tempfile.mkdtemp(), "collection.anki2"))
stock = {notetype.get("originalStockKind"): notetype for notetype in col.models.all()}
BASIC, REVERSED, CLOZE, IMAGE_OCCLUSION = 1, 2, 5, 6
spanish = col.decks.id("Spanish")
both_ways = col.decks.id("Spanish::Both ways")


def add(kind, deck, *values):
    note = col.new_note(stock[kind])
    for key, value in zip(note.keys(), values):
        note[key] = value
    col.add_note(note, deck)
    return note


add(BASIC, spanish, "el gato", "the cat, the kitty<br>Mi gato duerme.")
add(REVERSED, both_ways, "la casa", "the house")
add(REVERSED, both_ways, "la mesa", "the table")
add(CLOZE, spanish, "Ella {{c1::come::verb}} {{c2::pan}}.", "She eats bread.")

# a note type of someone's own, its fields named
vocab = col.models.new("Vocab")
for name in ["Word", "Meaning", "Sentence", "Audio"]:
    col.models.add_field(vocab, col.models.new_field(name))
template = col.models.new_template("Card 1")
template["qfmt"] = "{{Word}}"
template["afmt"] = "{{FrontSide}}<hr id=answer>{{Meaning}}"
col.models.add_template(vocab, template)
col.models.add(vocab)
note = col.new_note(col.models.by_name("Vocab"))
note["Word"], note["Meaning"], note["Sentence"], note["Audio"] = "el perro", "the dog", "El perro <b>ladra</b>.", "[sound:perro.mp3]"
col.add_note(note, spanish)

add(IMAGE_OCCLUSION, spanish, "{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:oi=1}}", '<img src="map.png">', "Where?", "", "")

# a card moved into a filtered deck for a while
add(BASIC, spanish, "el pájaro", "the bird")
filtered = col.sched.get_or_create_filtered_deck(deck_id=col.decks.new_filtered("Review"))
filtered.config.search_terms[0].search = 'front:"el pájaro"'
col.sched.add_or_update_filtered_deck(filtered)

for name, legacy, scheduling in [("anki-modern.apkg", False, True), ("anki-legacy.apkg", True, False)]:
    options = ExportAnkiPackageOptions(with_scheduling=scheduling, with_deck_configs=False, with_media=False, legacy=legacy)
    col.export_anki_package(out_path=os.path.join(out, name), options=options, limit=None)
col.close()
