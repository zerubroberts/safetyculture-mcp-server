// Renders every default report from the fictional demo organisation (SC_DEMO=true, never a real org)
// and saves full-page PNGs to assets/screenshots/report-<name>.png at 1440px, plus the board pack at 390px.
//   npx tsx scripts/shoot-reports.mjs [outDir=assets/screenshots] [--only=name,name]
// Set KEEP_REPORTS=1 to keep the generated HTML (its temp folder is printed) instead of deleting it.
// Uses playwright-core from $PLAYWRIGHT_CORE (default: the estate's gate-l0 tool) and a Chrome at $CHROME,
// like scripts/shoot.mjs. The headless browser is closed before the script exits.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const results = new Map();
for (const [name, tool, input] of jobs) {
  const data = await call(tool, input);
  files.push([name, data.html_path]);
  results.set(name, data);
  console.log(`${name}: ${data.html_path}`);
}
await client.close();
await server.close();

// ---- FIX-REPORT-3 assertions on the real demo output (one per finding; the unit tests pin the rest) ----
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};
const html = (name) => readFileSync(results.get(name).html_path, "utf8");
const textOf = (h) => h.replace(/<style>[\s\S]*?<\/style>/, "").replace(/href="[^"]*"/g, "");
if (results.has("site-scorecard")) check(html("site-scorecard").includes(`Period rate ${results.get("site-scorecard").metrics.failed_item_rate}%`), "1 scorecard rate caption = headline failed-item rate");
if (results.has("audit-pack")) check(html("audit-pack").includes(`Period average ${results.get("audit-pack").metrics.average_score}%`), "1 audit pack score caption = headline average score");
if (results.has("monthly-board-pack")) check(html("monthly-board-pack").includes(`12-month average ${results.get("monthly-board-pack").metrics.score_12_months}%`), "1 board pack caption = pooled 12-month score");
for (const [name] of files) check(!/averaging|\bMean \d/.test(textOf(html(name))), `1 ${name}: no 'averaging' or 'Mean' caption`);
if (results.has("action-backlog")) {
  const h = html("action-backlog");
  check(h.includes("Closed (completed or can&#39;t do)") && !h.includes("Closed in period"), "2 backlog: closed labelled as completed or can't do");
  check(/over \d+ completed/.test(h), "2 backlog: completed count shown separately");
}
for (const [name] of files) check(html(name).includes("color:var(--risk-text)"), `3 ${name}: worse chip uses the AA risk text colour`);
if (results.has("safety-pulse")) check(!/fails most often/.test(html("safety-pulse")), "4 pulse: no small-sample headline");
if (results.has("schedule-compliance")) {
  const h = html("schedule-compliance");
  check(!/lowest on-time rate: \d/.test(h) && !/is the least reliable schedule:/.test(h), "4 schedule: no headline on fewer than 20 resolved");
}
for (const [name] of files) check(!/\b\d{4}-\d{2}-\d{2}\b/.test(textOf(html(name))), `7 ${name}: one human date format (no ISO dates)`);
if (results.has("monthly-board-pack")) {
  const h = html("monthly-board-pack");
  check(h.includes("Overdue at period end") && h.includes("Overdue now"), "8 board pack: overdue as-of labels");
  check(/What changed<\/dt>[\s\S]*What to watch<\/dt>[\s\S]*What we need<\/dt>/.test(h), "9 board pack opens with the three-line brief");
  check(!/Target \d|Tolerance \d/.test(h), "9 board pack: no target drawn when none supplied");
}
if (results.has("inspection-quality")) check(/<th class="num">Items<\/th>/.test(html("inspection-quality")) && !/>Questions</.test(html("inspection-quality")), "8 quality: 'Items' column");

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/src/tools/gate-l0/node_modules/playwright-core");
const chrome =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath: chrome });
try {
  const base = (p) => p.split(/[\\/]/).pop();
  const shoot = async (file, out, width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: "load" });
    // Geometry: nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `geometry ${base(out)}: no horizontal overflow (${overflow}px)`);
    // 5: every dumbbell value label sits nearer its filled (current) dot than the hollow (previous) one.
    const strays = await page.evaluate((phone) => {
      let bad = 0;
      for (const svg of document.querySelectorAll(phone ? ".viz-n svg" : ".viz-w svg")) {
        const filled = [...svg.querySelectorAll("circle[r='5.5']")];
        const hollow = [...svg.querySelectorAll("circle[r='5']")];
        if (!filled.length) continue;
        for (const t of svg.querySelectorAll("text[font-weight='600']")) {
          if (!/^\d[\d.,]*%?$/.test(t.textContent ?? "")) continue;
          const tb = t.getBBox();
          const ty = tb.y + tb.height / 2;
          const near = (c) => Math.abs(Number(c.getAttribute("cy")) - ty) < 8;
          const dist = (c) => Math.min(Math.abs(Number(c.getAttribute("cx")) - tb.x), Math.abs(Number(c.getAttribute("cx")) - (tb.x + tb.width)));
          const f = filled.filter(near).map(dist);
          const h = hollow.filter(near).map(dist);
          if (f.length && h.length && Math.min(...h) < Math.min(...f)) bad++;
        }
      }
      return bad;
    }, width < 640);
    check(strays === 0, `5 ${base(out)}: dumbbell labels beside the filled dot (${strays} stray)`);
    await page.screenshot({ path: out, fullPage: true });
    await page.close();
    console.log(`saved ${out}`);
  };
  for (const [name, file] of files) {
    await shoot(file, join(outDir, `report-${name}.png`), 1440);
    if (name === "monthly-board-pack") await shoot(file, join(outDir, `report-${name}-390.png`), 390);
    if (name === "safety-pulse") await shoot(file, join(outDir, "report-safety-pulse-mobile.png"), 390);
  }
  // 6: printed on A4, chart text stays at or above 8pt (10.67px).
  for (const [name, file] of files) {
    const page = await browser.newPage({ viewport: { width: Math.round((182 / 25.4) * 96), height: 1100 } });
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const minPx = await page.evaluate(() => {
      let min = Infinity;
      for (const svg of document.querySelectorAll(".viz-w svg")) {
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        for (const t of svg.querySelectorAll("text")) min = Math.min(min, Number(t.getAttribute("font-size")) * scale);
      }
      return min;
    });
    check(minPx >= 10.66, `6 ${name}: smallest chart text in A4 print ${minPx.toFixed(2)}px (>= 8pt)`);
    await page.close();
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
if (failures.length) {
  console.error(`${failures.length} report assertion(s) failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else console.log("All report assertions passed.");
