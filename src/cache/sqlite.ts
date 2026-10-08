import { createRequire } from "node:module";

type SqliteModule = typeof import("node:sqlite");

let loaded: SqliteModule | undefined;

/**
 * Loads `node:sqlite` while muting only its "SQLite is an experimental feature" warning.
 * The module is required lazily (not imported statically) so the filter is in place when Node
 * emits the warning; every other warning, including other ExperimentalWarnings, passes through,
 * and process.emitWarning is restored straight after.
 */
export function sqlite(): SqliteModule {
  if (loaded) return loaded;
  const original = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    if (isSqliteExperimentalWarning(warning, rest[0])) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    loaded = createRequire(import.meta.url)("node:sqlite") as SqliteModule;
  } finally {
    process.emitWarning = original;
  }
  return loaded;
}

export function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const type =
    typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeOrOptions && typeof typeOrOptions === "object"
        ? (typeOrOptions as { type?: string }).type
        : undefined;
  const name = warning instanceof Error ? warning.name : type;
  const message = warning instanceof Error ? warning.message : String(warning);
  return (type === "ExperimentalWarning" || name === "ExperimentalWarning") && /sqlite/i.test(message);
}
