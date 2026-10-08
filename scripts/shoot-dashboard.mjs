// Dev utility: builds the dashboard from the fictional demo organisation (SC_DEMO=true, never a real org),
// screenshots it and checks chart geometry (clipped or overlapping labels, tiny text, horizontal scroll).
//   npx tsx scripts/shoot-dashboard.mjs [outDir=assets/screenshots]
// Uses playwright-core from $PLAYWRIGHT_CORE (default: the estate's gate-l0 tool) and a Chrome at $CHROME.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.ts";
import { buildServer } from "../src/server.ts";
import { ALL_TOOLS } from "../src/toolsets/index.ts";
import { dashboardTools } from "../src/toolsets/dashboards.ts";

const outDir = process.argv[2] ?? "assets/screenshots";
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "scmcp-dashboard-"));
const config = loadConfig({ SC_DEMO: "true", SC_MODE: "read-only", SC_TOOLSETS: "all", SC_DATA_DIR: tmp });
if (!config.demo) throw new Error("Screenshots must come from demo mode.");
const tools = [...ALL_TOOLS.filter((t) => t.name !== "sc_build_dashboard"), ...dashboardTools];
const { server } = buildServer(config, { tools });
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "shoot-dashboard", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);
const started = Date.now();
const res = await client.callTool({ name: "sc_build_dashboard", arguments: { period: "last 90 days" } });
const text = res.content.map((c) => c.text).join("\n");
if (res.isError) throw new Error(text);
const path = /"html_path":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1]?.replace(/\\\\/g, "\\");
console.log(`built in ${Date.now() - started} ms: ${path}`);
await client.close();

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/src/tools/gate-l0/node_modules/playwright-core");
const chrome = process.env.CHROME ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const url = pathToFileURL(resolve(path)).href;
const blocked = [];
const errors = [];

/** Clicks through every filter combination once and checks the page reacts (no errors, tooltip shows, sort works). */
async function interact() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(`interact: ${e.message}`));
  await page.goto(`${url}#/overview`, { waitUntil: "load" });
  const sites = await page.$$eval("#site option", (o) => o.map((x) => x.value));
  const periods = await page.$$eval("[data-period]", (b) => b.map((x) => x.getAttribute("data-period")));
  for (const v of ["overview", "inspections", "actions", "schedules", "sites", "team"])
    for (const p of periods)
      for (const s of sites) {
        await page.evaluate((h) => (location.hash = h), `#/${v}?period=${p}${s === "all" ? "" : `&site=${s}`}`);
        await page.waitForTimeout(5);
      }
  await page.evaluate((h) => (location.hash = h), "#/overview?period=90d");
  await page.selectOption("#site", sites[1] ?? "all");
  const chip = await page.textContent("#chips");
  await page.click('[data-period="7d"]');
  await page.waitForTimeout(400);
  const cells = await page.$$('[data-chart="cal"] rect[data-tip]');
  const cell = cells[cells.length - 2];
  await cell.scrollIntoViewIfNeeded();
  await cell.hover({ force: true });
  const tipShown = await page.$eval("#tip", (t) => t.classList.contains("show") && t.textContent.length > 0);
  await page.evaluate((h) => (location.hash = h), "#/inspections?period=90d");
  await page.click('[data-sort="t-items"][data-k="failed"]');
  const sorted = await page.$eval('[data-sort="t-items"][data-k="failed"]', (b) => b.closest("th").getAttribute("aria-sort"));
  await page.click("#theme");
  const theme = await page.$eval("html", (h) => h.getAttribute("data-theme"));
  console.log(`interact: ${periods.length} periods x ${sites.length} site filters x 6 views rendered; site chip "${chip.slice(0, 60)}"; tooltip ${tipShown ? "shown" : "MISSING"}; sort ${sorted}; theme toggled to ${theme}`);
  if (!tipShown || !sorted) errors.push("interact: tooltip or sort failed");
  await page.close();
}

/** Geometry audit run inside the page: every SVG text must sit inside its SVG, not collide, and be >= 11px. */
const audit = () => {
  const problems = [];
  const doc = document.scrollingElement;
  if (doc.scrollWidth > window.innerWidth + 1) problems.push(`horizontal scroll: ${doc.scrollWidth} > ${window.innerWidth}`);
  document.querySelectorAll("svg.c").forEach((svg, si) => {
    const W = svg.width.baseVal.value;
    const H = svg.height.baseVal.value;
    const boxes = [];
    svg.querySelectorAll("text").forEach((t) => {
      if (!t.textContent.trim()) return;
      const fs = parseFloat(getComputedStyle(t).fontSize);
      if (fs < 11) problems.push(`svg${si}: ${fs}px text "${t.textContent}"`);
      const bb = t.getBBox();
      if (bb.x < -0.5 || bb.x + bb.width > W + 0.5 || bb.y < -0.5 || bb.y + bb.height > H + 0.5) problems.push(`svg${si} (${svg.getAttribute("aria-label")}): clipped "${t.textContent}" [${Math.round(bb.x)},${Math.round(bb.x + bb.width)}] of ${W}`);
      boxes.push({ t: t.textContent, x0: bb.x, x1: bb.x + bb.width, y0: bb.y, y1: bb.y + bb.height });
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i], q = boxes[j];
        const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
        const oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
        if (ox > 1 && oy > 2) problems.push(`svg${si} (${svg.getAttribute("aria-label")}): overlap "${p.t}" / "${q.t}"`);
      }
  });
  document.querySelectorAll(".tile .v, .tile .l, .tile .d, td, th, .legend li, .chip").forEach((el) => {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") problems.push(`overflowing ${el.className || el.tagName}: "${el.textContent.slice(0, 40)}"`);
  });
  return problems;
};

async function shoot(name, view, width, height, theme = "light", full = true) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: "reduce" });
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) blocked.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`${url}#/${view}?period=90d`, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const problems = await page.evaluate(audit);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log(`${file}: ${problems.length ? `${problems.length} geometry problems\n  ${problems.join("\n  ")}` : "geometry clean"}`);
  await page.close();
  return problems.length;
}

let issues = 0;
const extra = process.env.SHOOT_ALL === "1";
issues += await shoot("dashboard-overview-1440", "overview", 1440, 900);
issues += await shoot("dashboard-overview-390", "overview", 390, 844);
issues += await shoot("dashboard-actions-1440", "actions", 1440, 900);
issues += await shoot("dashboard-sites-1440", "sites", 1440, 900);
issues += await shoot("dashboard-dark-1440", "overview", 1440, 900, "dark");
if (extra) {
  // every view at both widths and both themes, for review only (not committed)
  const scratch = join(outDir, "all");
  mkdirSync(scratch, { recursive: true });
  for (const v of ["overview", "inspections", "actions", "schedules", "sites", "team"])
    for (const [w, h] of [[1440, 900], [390, 844]])
      for (const th of ["light", "dark"]) issues += await shoot(`all/${v}-${w}-${th}`, v, w, h, th);
}
await interact();
await browser.close();
if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
issues += errors.length;
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  // Windows keeps the SQLite file locked until the process exits; the OS temp folder cleans it up.
}
if (blocked.length) console.log(`network requests attempted: ${blocked.join(", ")}`);
console.log(issues || blocked.length ? `FAIL: ${issues} geometry problems, ${blocked.length} requests` : "all clean");
process.exit(issues || blocked.length ? 1 : 0);
