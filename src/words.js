import { fetchNotes } from "./anki.js";
import { parseNotes } from "./parse.js";
import { loadWordsCache, saveWordsCache } from "./store.js";

// words come from Anki; if it's closed, fall back to the last successful read
export async function loadWords(deck) {
  try {
    const { words, skipped } = parseNotes(await fetchNotes(deck));
    await saveWordsCache(deck, words);
    return { words, skipped, cached: false };
  } catch (err) {
    const cache = await loadWordsCache();
    if (cache?.deck === deck && cache.words.length) return { words: cache.words, skipped: 0, cached: true };
    throw err;
  }
}
