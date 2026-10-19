import * as zlib from "node:zlib";

// What Anki packages need from Node: its built-in SQLite (node:sqlite, there without a flag since
// 22.13) and zstd (22.15), which newer Anki packages are compressed with. Node 22 and 24 still print
// "SQLite is an experimental feature" when it loads, which tells someone moving a deck nothing, so
// that one warning is left out. Any other warning still shows.
export const ANKI_NODE = "22.15";

const needsNode = () => Object.assign(new Error(`Anki packages need Node ${ANKI_NODE}`), { code: "NEEDS_NODE", version: ANKI_NODE });

export async function loadSqlite() {
  if (typeof zlib.zstdDecompressSync !== "function") throw needsNode();
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    if (type === "ExperimentalWarning" && String(warning?.message ?? warning).includes("SQLite")) return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    return await import("node:sqlite");
  } catch (err) {
    throw err.code === "ERR_UNKNOWN_BUILTIN_MODULE" ? needsNode() : err;
  } finally {
    process.emitWarning = emitWarning;
  }
}

export const unzstd = (buffer) => zlib.zstdDecompressSync(buffer);
