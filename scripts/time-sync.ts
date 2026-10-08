// Dev utility: times a sync of the given feeds against the configured org. Prints counts only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildServer } from "../src/server.js";
import type { FeedName } from "../src/cache/contract.js";
import { syncFeeds } from "../src/cache/index.js";

const feeds = process.argv.slice(2) as FeedName[];
const cfg = loadConfig({ ...process.env, SC_DATA_DIR: mkdtempSync(join(tmpdir(), "scmcp-time-")) });
const { ctx } = buildServer(cfg);
const t0 = Date.now();
const { reports } = await syncFeeds(ctx, feeds);
console.log(JSON.stringify(reports, null, 1), `total ${Date.now() - t0} ms`);
