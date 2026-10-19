import { t } from "./i18n.js";

// Node's built-in SQLite (node:sqlite), for Anki packages. It's there without a flag since Node 22.13;
// Node 22 and 24 still print "SQLite is an experimental feature" when it loads, which tells someone
// exporting a deck nothing, so that one warning is left out. Any other warning still shows.
export const SQLITE_NODE = "22.13";

export async function loadSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    if (type === "ExperimentalWarning" && String(warning?.message ?? warning).includes("SQLite")) return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    return await import("node:sqlite");
  } catch (err) {
    if (err.code === "ERR_UNKNOWN_BUILTIN_MODULE") throw new Error(t("export.needsNode", { version: SQLITE_NODE, current: process.versions.node }));
    throw err;
  } finally {
    process.emitWarning = emitWarning;
  }
}
