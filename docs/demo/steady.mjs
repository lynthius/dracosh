// Loaded before Dracosh in the demo (node --import): "random" numbers stay near zero, so the waiting
// cards come in deck order and the recorded answers fit them, however long the run takes.
let n = 0;
Math.random = () => (n = (n + 1) % 1000) / 1e7;
