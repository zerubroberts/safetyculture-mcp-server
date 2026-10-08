import type { CacheProvider, ToolContext } from "../core/registry.js";
import { ToolError } from "../core/errors.js";

/**
 * Wave-1 placeholder. Ticket SCMCP-W5 replaces this with the node:sqlite store + incremental sync
 * (src/cache/store.ts, src/cache/sync.ts, src/cache/feeds.ts) behind the same CacheProvider interface.
 */
export function createCacheProvider(_ctx: Omit<ToolContext, "cache">): CacheProvider {
  const notReady = async (): Promise<never> => {
    throw new ToolError("The local analytics cache is not available in this build yet.");
  };
  return { open: notReady, ensure: notReady };
}
