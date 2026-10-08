// Dev utility: builds the dashboard from the fictional demo organisation (SC_DEMO=true, never a real org),
// screenshots it and checks chart geometry (clipped or overlapping labels, tiny text, horizontal scroll).
//   npx tsx scripts/shoot-dashboard.mjs [outDir=assets/screenshots]
// Uses playwright-core from $PLAYWRIGHT_CORE (default: the estate's gate-l0 tool) and a Chrome at $CHROME.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/**
 * Design-review sweep (FIX-DASH-2): every finding from the independent review is a check here, run on the
 * built demo file at desktop and phone widths, so a later change that regresses one fails the run.
 */
async function sweep() {
  const failures = [];
  const check = (ok, what) => {
    console.log(`  ${ok ? "pass" : "FAIL"}  ${what}`);
    if (!ok) failures.push(what);
  };
  const html = readFileSync(path, "utf8");
  const data = JSON.parse(html.split('<script type="application/json" id="dash-data">')[1].split("</script>")[0]);
  const site1 = data.sites[0];
  const open = async (hash, width = 1440, theme = "light") => {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: theme, reducedMotion: "reduce" });
    page.on("pageerror", (e) => errors.push(`sweep ${hash}: ${e.message}`));
    await page.goto(`${url}${hash}`, { waitUntil: "load" });
    await page.waitForTimeout(250);
    return page;
  };
  console.log("sweep:");

  // 1. League table keeps its layout under a site filter, desktop and phone.
  for (const w of [1440, 390]) {
    const page = await open(`#/sites?period=90d&site=${site1.key}`, w);
    const m = await page.evaluate(() => {
      const tw = document.querySelector('[data-sort="t-league"]').closest(".tw");
      const ths = [...tw.querySelectorAll("th")].map((th) => Math.round(th.getBoundingClientRect().width));
      const sel = tw.querySelector("tr.row-sel");
      const siteCell = sel ? sel.children[1] : null;
      const lh = siteCell ? parseFloat(getComputedStyle(siteCell).lineHeight) || 20 : 20;
      return { overflow: tw.scrollWidth - tw.clientWidth, rankW: ths[0], selected: Boolean(sel), siteLines: siteCell ? Math.round((siteCell.getBoundingClientRect().height - 18) / lh) : 0 };
    });
    check(m.selected && m.rankW <= 64 && m.siteLines <= 1 && (w < 600 || m.overflow <= 1), `league table under a site filter at ${w}px: # column ${m.rankW}px, selected row site name ${m.siteLines} line(s), overflow ${m.overflow}px`);
    await page.close();
  }

  // 2. Actions: closed vs completed spelled out the same way on every surface.
  {
    const page = await open("#/actions?period=90d");
    const t = await page.evaluate(() => ({
      answer: document.querySelector(".answer").textContent,
      legend: [...document.querySelectorAll(".legend li")].map((l) => l.textContent).join(" | "),
      tile: [...document.querySelectorAll(".tile")].find((x) => x.querySelector(".l").textContent === "Actions completed")?.textContent ?? "",
      all: document.querySelector("#main").textContent,
    }));
    const m = /([\d,]+) closed \(([\d,]+) completed, ([\d,]+) closed without completing/.exec(t.answer);
    const n = (s) => Number(String(s).replace(/,/g, ""));
    const s = data.slices["90d|all"].actions;
    check(Boolean(m) && n(m[1]) === n(m[2]) + n(m[3]) && n(m[1]) === s.metrics.closed_in_period && t.tile.includes(m[2]), `actions headline splits closed into completed + other (${m ? m[0] : t.answer.slice(0, 90)}) and matches the KPI`);
    check(t.legend.includes("Closed (completed or can't do)") && !t.all.includes("has a completion date"), "opened/closed legend says \"Closed (completed or can't do)\"");
    check(t.tile.includes("of " + s.metrics.closed_in_period + " closed"), "Actions completed tile says how many were closed in all");
    await page.close();
  }

  // 3. Schedule stripes start at the first week with something due; the caption explains and survives 390px.
  for (const w of [1440, 390]) {
    const page = await open("#/schedules?period=90d", w);
    const m = await page.evaluate(() => {
      const svg = document.querySelector('[data-chart="stripes"] svg');
      const first = svg.querySelector('rect[class^="q"]');
      const cap = [...document.querySelectorAll(".card .foot, .card .sub")].find((e) => /before/.test(e.textContent) && /due/.test(e.textContent));
      const r = cap ? cap.getBoundingClientRect() : null;
      return { firstX: first ? Number(first.getAttribute("x")) : -1, empty: svg.querySelectorAll(".nodue").length, cap: cap ? cap.textContent : "", capInside: r ? r.right <= window.innerWidth && r.left >= 0 : false };
    });
    check(m.firstX >= 0 && m.firstX < 2 && m.empty === 0 && m.cap && m.capInside, `stripes at ${w}px start at the first due week (first stripe x=${m.firstX}) with caption "${m.cap.slice(0, 70)}"`);
    await page.close();
  }

  // 4. Trend wording names the recent movement when it differs from the fitted direction.
  {
    const page = await open("#/inspections?period=90d");
    const subs = await page.$$eval(".card .sub", (e) => e.map((x) => x.textContent));
    for (const metric of ["failed_item_rate", "average_score"]) {
      const sr = data.scopes.all.trends.w[metric];
      check(!sr.recent || subs.some((x) => x.includes(sr.recent)), `${metric} subtitle carries the recent movement ("${sr.recent ?? "none"}") next to "${sr.direction}"`);
    }
    await page.close();
  }

  // 5. People: the outlier leads (headline + highlighted row), no darkening of the top three by volume.
  {
    const page = await open("#/team?period=90d");
    const m = await page.evaluate(() => ({
      answer: document.querySelector(".answer").textContent,
      selRows: document.querySelectorAll('[data-sort="t-people"]').length ? document.querySelector('[data-sort="t-people"]').closest(".tw").querySelectorAll("tr.row-sel").length : 0,
      hot: document.querySelectorAll('[data-chart="people"] .bar.hot').length,
      risk: document.querySelectorAll('[data-chart="people"] .bar.risk').length,
    }));
    const team = data.slices["90d|all"].team;
    const has = team.outlier_index !== null;
    check(has ? m.answer.startsWith("One inspector stands out") && m.selRows === 1 && m.risk <= 1 && m.hot === 0 : m.hot === 0, `people view leads with the outlier (headline "${m.answer.slice(0, 60)}", highlighted rows ${m.selRows}, dark top-3 bars ${m.hot})`);
    check(/not a performance/.test(m.answer) || !has, "outlier headline keeps \"not a performance verdict\"");
    await page.close();
  }

  // 6. Status pills and severity chips: >= 11px and >= 4.5:1 in both themes.
  for (const theme of ["light", "dark"]) {
    for (const v of ["overview", "actions"]) {
      const page = await open(`#/${v}?period=90d`, 1440, theme);
      const worst = await page.evaluate(() => {
        const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        const rgb = (c, under) => {
          cv.clearRect(0, 0, 1, 1);
          if (under) { cv.fillStyle = under; cv.fillRect(0, 0, 1, 1); }
          cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
          return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const opaqueBg = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b; } return getComputedStyle(document.body).backgroundColor; };
        let out = { ratio: 99, size: 99, text: "" };
        document.querySelectorAll(".pill, .sev").forEach((el) => {
          const cs = getComputedStyle(el);
          const under = opaqueBg(el);
          const bg = rgb(cs.backgroundColor, rgb(under).length ? under : null);
          const fg = rgb(cs.color, `rgb(${bg.join(",")})`);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < out.ratio || parseFloat(cs.fontSize) < out.size) out = { ratio: Math.min(ratio, out.ratio), size: Math.min(parseFloat(cs.fontSize), out.size), text: el.textContent };
        });
        return out;
      });
      check(worst.ratio >= 4.5 && worst.size >= 11, `${v} pills/chips in ${theme}: lowest contrast ${worst.ratio.toFixed(2)}:1, smallest ${worst.size}px ("${worst.text}")`);
      await page.close();
    }
  }

  // 7. The eyebrow names the filtered site on every view.
  {
    const page = await open(`#/overview?period=90d&site=${site1.key}`);
    const bad = [];
    for (const v of ["overview", "inspections", "actions", "schedules", "sites", "team"]) {
      await page.evaluate((h) => (location.hash = h), `#/${v}?period=90d&site=${site1.key}`);
      await page.waitForTimeout(80);
      const eb = await page.textContent(".eyebrow");
      if (!eb.includes(site1.name)) bad.push(`${v}: "${eb}"`);
    }
    check(!bad.length, `eyebrow names the filtered site on every view${bad.length ? ` (${bad.join("; ")})` : ""}`);
    await page.close();
  }

  // 8. Tap targets >= 44px on phones; the dot-strip's age bands stay readable at 390.
  for (const v of ["overview", "inspections", "actions"]) {
    const page = await open(`#/${v}?period=90d`, 390);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("#main a")]
        .filter((a) => !a.closest(".foot-data") && a.getClientRects().length)
        .map((a) => { const r = a.getBoundingClientRect(); return { t: a.textContent.slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((r) => r.w < 44 || r.h < 44),
    );
    check(!small.length, `${v} at 390px: every link has a 44px tap target${small.length ? ` (${small.length} small, e.g. "${small[0].t}" ${small[0].w}x${small[0].h})` : ""}`);
    if (v === "actions") {
      const txt = await page.textContent("#main");
      check(["0-7 d", "8-30 d", "31-90 d", "90+ d"].every((b) => txt.includes(b)), "actions at 390px: all four age bands (0-7, 8-30, 31-90, 90+ d) are labelled with counts");
    }
    await page.close();
  }

  // Named weaknesses: compact phone nav, sparklines on every schedule KPI, failed-item rates at 2 dp everywhere.
  {
    const page = await open("#/overview?period=90d", 390);
    const top = await page.$eval("#site", (e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
    check(top <= 200, `phone nav is compact: filters start ${top}px down (<= 200)`);
    await page.close();
    const p2 = await open("#/schedules?period=90d");
    const sparks = await p2.$$eval(".tile", (t) => t.map((x) => Boolean(x.querySelector(".spark svg"))));
    check(sparks.length === 4 && sparks.every(Boolean), `every schedule KPI tile has a sparkline (${sparks.filter(Boolean).length}/${sparks.length})`);
    await p2.close();
    const rateCells = async (hash, sortId, header) => {
      const pg = await open(hash);
      const cells = await pg.evaluate(([id, h]) => {
        const tw = document.querySelector(`[data-sort="${id}"]`).closest(".tw");
        const idx = [...tw.querySelectorAll("th")].findIndex((th) => th.textContent.replace(/[▲▼▽]/g, "").trim() === h);
        return [...tw.querySelectorAll("tbody tr")].map((tr) => tr.children[idx].textContent.trim());
      }, [sortId, header]);
      await pg.close();
      return cells;
    };
    const rates = [
      ...(await rateCells("#/inspections?period=90d", "t-items", "Failure rate")),
      ...(await rateCells("#/sites?period=90d", "t-league", "Failed rate")),
      ...(await rateCells("#/team?period=90d", "t-people", "Failed rate")),
    ].filter((x) => x !== "n/a");
    const bad = rates.filter((x) => !/^\d+\.\d\d%$/.test(x));
    check(rates.length > 0 && !bad.length, `failed-item rates show 2 dp in every table (${rates.length} cells${bad.length ? `, bad: ${bad.slice(0, 3).join(", ")}` : ""})`);
  }
  return failures.length;
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
const sweepOnly = process.env.SWEEP_ONLY === "1";
if (!sweepOnly) {
  issues += await shoot("dashboard-overview-1440", "overview", 1440, 900);
  issues += await shoot("dashboard-overview-390", "overview", 390, 844);
  issues += await shoot("dashboard-actions-1440", "actions", 1440, 900);
  issues += await shoot("dashboard-sites-1440", "sites", 1440, 900);
  issues += await shoot("dashboard-dark-1440", "overview", 1440, 900, "dark");
}
issues += await sweep();
if (extra) {
  // every view at both widths and both themes, for review only (not committed)
  const scratch = join(outDir, "all");
  mkdirSync(scratch, { recursive: true });
  for (const v of ["overview", "inspections", "actions", "schedules", "sites", "team"])
    for (const [w, h] of [[1440, 900], [390, 844]])
      for (const th of ["light", "dark"]) issues += await shoot(`all/${v}-${w}-${th}`, v, w, h, th);
}
if (!sweepOnly) await interact();
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
