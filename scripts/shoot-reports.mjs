// Renders every default report from the fictional demo organisation (SC_DEMO=true, never a real org)
// and saves full-page PNGs to assets/screenshots/report-<name>.png at 1440px, plus the board pack at 390px.
//   npx tsx scripts/shoot-reports.mjs [outDir=assets/screenshots] [--only=name,name]
// Set KEEP_REPORTS=1 to keep the generated HTML (its temp folder is printed) instead of deleting it.
// Uses playwright-core from $PLAYWRIGHT_CORE (default: the estate's gate-l0 tool) and a Chrome at $CHROME,
// like scripts/shoot.mjs. The headless browser is closed before the script exits.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.ts";
import { buildServer } from "../src/server.ts";

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--")) ?? "assets/screenshots";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
mkdirSync(outDir, { recursive: true });

const dataDir = mkdtempSync(join(tmpdir(), "scmcp-shoot-"));
const config = loadConfig({ SC_DEMO: "true", SC_MODE: "read-only", SC_TOOLSETS: "all", SC_DATA_DIR: dataDir, SC_EXPORT_DIR: join(dataDir, "exports") });
if (!config.demo) throw new Error("Report screenshots must run in demo mode.");
const { server } = buildServer(config);
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "shoot-reports", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);

async function call(name, input = {}) {
  const res = await client.callTool({ name, arguments: input });
  const text = res.content.map((c) => c.text).join("\n");
  if (res.isError) throw new Error(`${name} failed: ${text.slice(0, 300)}`);
  const body = text.split("\n\nNote: output trimmed")[0];
  const inner = body.includes("<untrusted-data>") ? body.split("<untrusted-data>\n")[1].split("\n</untrusted-data>")[0] : body;
  return JSON.parse(inner.split("\n").pop());
}

// The scorecard needs a site: the bottom of the demo league (a fictional site).
const league = await call("sc_analyze_site_league", { period: "last 90 days" });
const worstSite = league.table[league.table.length - 1].site_id;

const jobs = [
  ["safety-pulse", "sc_report_safety_pulse", {}],
  ["audit-pack", "sc_report_audit_pack", {}],
  ["site-scorecard", "sc_report_site_scorecard", { site_id: worstSite }],
  ["monthly-board-pack", "sc_report_monthly_board_pack", {}],
  ["action-backlog", "sc_report_action_backlog", {}],
  ["schedule-compliance", "sc_report_schedule_compliance", {}],
  ["inspection-quality", "sc_report_inspection_quality", {}],
].filter(([name]) => !only.length || only.includes(name));

const files = [];
for (const [name, tool, input] of jobs) {
  const data = await call(tool, input);
  files.push([name, data.html_path]);
  console.log(`${name}: ${data.html_path}`);
}
await client.close();
await server.close();

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/src/tools/gate-l0/node_modules/playwright-core");
const chrome =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath: chrome });
try {
  const shoot = async (file, out, width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: "load" });
    // Geometry check: nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) console.warn(`WARNING ${out}: horizontal overflow ${overflow}px`);
    await page.screenshot({ path: out, fullPage: true });
    await page.close();
    console.log(`saved ${out}`);
  };
  for (const [name, file] of files) {
    await shoot(file, join(outDir, `report-${name}.png`), 1440);
    if (name === "monthly-board-pack") await shoot(file, join(outDir, `report-${name}-390.png`), 390);
    if (name === "safety-pulse") await shoot(file, join(outDir, "report-safety-pulse-mobile.png"), 390);
  }
} finally {
  await browser.close();
  if (!process.env.KEEP_REPORTS) {
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      // The demo cache file can stay locked on Windows until this process exits.
      console.warn(`Could not remove ${dataDir} (${e.code ?? e}); delete it by hand.`);
    }
  }
}
