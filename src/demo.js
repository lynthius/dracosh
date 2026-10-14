// A small built-in EN ↔ PL word set: used by the preview gallery, and a seed for the future demo deck.
export const DEMO_WORDS = [
  { noteId: 1, word: "dragon", translations: ["smok"], example: "The dragon guarded its gold." },
  { noteId: 2, word: "egg", translations: ["jajko", "jajo"], example: "The egg began to crack." },
  { noteId: 3, word: "to hatch", translations: ["wykluć się"], example: "The chicks will hatch tomorrow." },
  { noteId: 4, word: "genuine", translations: ["autentyczny", "szczery"], example: "Her apology felt genuine." },
  { noteId: 5, word: "software", translations: ["oprogramowanie"], example: "The software update fixed the bug." },
  { noteId: 6, word: "to grow", translations: ["rosnąć"], example: "Plants grow towards the light." },
  { noteId: 7, word: "fire", translations: ["ogień"], example: "Dragons breathe fire." },
  { noteId: 8, word: "streak", translations: ["seria", "passa"], example: "She kept her streak for a month." }
];

// Cards for the preview's answering scenes: sentences too long to type word for word (reveal them and
// grade yourself), and cloze cards asked one gap at a time
export const DEMO_SENTENCES = [
  { noteId: "s1", word: "Drop me a line when you get there.", translations: ["Odezwij się, jak dojedziesz."] },
  { noteId: "s2", word: "It's not my cup of tea.", translations: ["To nie moja bajka."], example: "Opera? It's not my cup of tea." }
];
export const DEMO_CLOZE = [
  { noteId: "z1", word: "I'm {{looking forward}} to {{it}}.", translations: ["Cieszę się na to."], cloze: ["looking forward", "it"], directions: ["c1", "c2"] },
  { noteId: "z2", word: "Dragons {{breathe}} fire.", translations: ["Smoki zieją ogniem."], cloze: ["breathe"], directions: ["c1"] }
];
