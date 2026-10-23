// The deck the welcome offers: 30 everyday words for any pair of these languages. Each word has one
// usual translation in every language, so the card can be asked both ways; a noun keeps its article
// where the language has one. `also`: other answers that count, in that language, when it's the one
// you speak (the card's back); the one you're learning is always asked in its first form.
export const FIRST_WORDS_LANGUAGES = ["en", "pl", "de", "fr", "uk", "es", "it"];

const WORDS = [
  { en: "water", pl: "woda", de: "das Wasser", fr: "l'eau", uk: "вода", es: "el agua", it: "l'acqua" },
  { en: "bread", pl: "chleb", de: "das Brot", fr: "le pain", uk: "хліб", es: "el pan", it: "il pane" },
  { en: "milk", pl: "mleko", de: "die Milch", fr: "le lait", uk: "молоко", es: "la leche", it: "il latte" },
  { en: "apple", pl: "jabłko", de: "der Apfel", fr: "la pomme", uk: "яблуко", es: "la manzana", it: "la mela" },
  { en: "coffee", pl: "kawa", de: "der Kaffee", fr: "le café", uk: "кава", es: "el café", it: "il caffè" },
  { en: "egg", pl: "jajko", de: "das Ei", fr: "l'œuf", uk: "яйце", es: "el huevo", it: "l'uovo", also: { pl: ["jajo"] } },
  { en: "dog", pl: "pies", de: "der Hund", fr: "le chien", uk: "собака", es: "el perro", it: "il cane", also: { uk: ["пес"] } },
  { en: "cat", pl: "kot", de: "die Katze", fr: "le chat", uk: "кіт", es: "el gato", it: "il gatto", also: { uk: ["кішка"] } },
  { en: "bird", pl: "ptak", de: "der Vogel", fr: "l'oiseau", uk: "птах", es: "el pájaro", it: "l'uccello", also: { es: ["el ave"], uk: ["пташка"] } },
  { en: "book", pl: "książka", de: "das Buch", fr: "le livre", uk: "книга", es: "el libro", it: "il libro", also: { uk: ["книжка"] } },
  { en: "school", pl: "szkoła", de: "die Schule", fr: "l'école", uk: "школа", es: "la escuela", it: "la scuola", also: { es: ["el colegio"] } },
  { en: "city", pl: "miasto", de: "die Stadt", fr: "la ville", uk: "місто", es: "la ciudad", it: "la città", also: { en: ["town"] } },
  { en: "train", pl: "pociąg", de: "der Zug", fr: "le train", uk: "поїзд", es: "el tren", it: "il treno", also: { uk: ["потяг"] } },
  { en: "key", pl: "klucz", de: "der Schlüssel", fr: "la clé", uk: "ключ", es: "la llave", it: "la chiave", also: { fr: ["la clef"] } },
  { en: "door", pl: "drzwi", de: "die Tür", fr: "la porte", uk: "двері", es: "la puerta", it: "la porta" },
  { en: "window", pl: "okno", de: "das Fenster", fr: "la fenêtre", uk: "вікно", es: "la ventana", it: "la finestra" },
  { en: "sun", pl: "słońce", de: "die Sonne", fr: "le soleil", uk: "сонце", es: "el sol", it: "il sole" },
  { en: "rain", pl: "deszcz", de: "der Regen", fr: "la pluie", uk: "дощ", es: "la lluvia", it: "la pioggia" },
  { en: "snow", pl: "śnieg", de: "der Schnee", fr: "la neige", uk: "сніг", es: "la nieve", it: "la neve" },
  { en: "fire", pl: "ogień", de: "das Feuer", fr: "le feu", uk: "вогонь", es: "el fuego", it: "il fuoco" },
  { en: "tree", pl: "drzewo", de: "der Baum", fr: "l'arbre", uk: "дерево", es: "el árbol", it: "l'albero" },
  { en: "day", pl: "dzień", de: "der Tag", fr: "le jour", uk: "день", es: "el día", it: "il giorno", also: { fr: ["la journée"], it: ["la giornata"] } },
  { en: "night", pl: "noc", de: "die Nacht", fr: "la nuit", uk: "ніч", es: "la noche", it: "la notte" },
  { en: "week", pl: "tydzień", de: "die Woche", fr: "la semaine", uk: "тиждень", es: "la semana", it: "la settimana" },
  { en: "to eat", pl: "jeść", de: "essen", fr: "manger", uk: "їсти", es: "comer", it: "mangiare" },
  { en: "to drink", pl: "pić", de: "trinken", fr: "boire", uk: "пити", es: "beber", it: "bere" },
  { en: "to sleep", pl: "spać", de: "schlafen", fr: "dormir", uk: "спати", es: "dormir", it: "dormire" },
  { en: "to read", pl: "czytać", de: "lesen", fr: "lire", uk: "читати", es: "leer", it: "leggere" },
  { en: "to speak", pl: "mówić", de: "sprechen", fr: "parler", uk: "говорити", es: "hablar", it: "parlare", also: { en: ["to talk"], pl: ["rozmawiać"], de: ["reden"], uk: ["розмовляти"] } },
  { en: "thank you", pl: "dziękuję", de: "danke", fr: "merci", uk: "дякую", es: "gracias", it: "grazie", also: { en: ["thanks"], pl: ["dzięki"], de: ["danke schön", "dankeschön"] } }
];

export const hasFirstWords = (home, learning) => home !== learning && [home, learning].every((code) => FIRST_WORDS_LANGUAGES.includes(code));

// the cards for someone who speaks `home` and learns `learning`: the new word on the front
export const firstWords = (home, learning) => WORDS.map((word) => ({ front: word[learning], back: [word[home], ...(word.also?.[home] ?? [])] }));

// one card of the pair, as /add's example of a card ("el gato = cat")
export function sampleCard(home, learning) {
  const cat = WORDS.find((word) => word.en === "cat");
  return { front: cat[learning], back: [cat[home]] };
}
