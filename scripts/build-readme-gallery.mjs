// Crops the top of each full-page screenshot into a README gallery preview (assets/readme/gallery/).
// The README links each preview to the full screenshot. Re-run after re-shooting screenshots:
//   node scripts/build-readme-gallery.mjs
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/src/tools/gate-l0/node_modules/playwright-core");
const chrome = process.env.CHROME ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);

// [source, output, crop height in CSS px of the 1440-wide (or 390-wide) layout]
const CROPS = [
  ["dashboard-overview-1440.png", "dashboard-overview.png", 1000],
  ["dashboard-actions-1440.png", "dashboard-actions.png", 1000],
  ["dashboard-sites-1440.png", "dashboard-sites.png", 1000],
  ["dashboard-dark-1440.png", "dashboard-dark.png", 1000],
  ["dashboard-overview-390.png", "dashboard-phone.png", 1500],
  ["report-monthly-board-pack.png", "report-board-pack.png", 1600],
  ["report-monthly-board-pack-390.png", "report-board-pack-phone.png", 1500],
  ["report-action-backlog.png", "report-action-backlog.png", 1600],
  ["report-schedule-compliance.png", "report-schedule-compliance.png", 1600],
  ["report-inspection-quality.png", "report-inspection-quality.png", 1600],
  ["report-site-scorecard.png", "report-site-scorecard.png", 1600],
];

const width = (buf) => buf.readUInt32BE(16);
mkdirSync("assets/readme/gallery", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
for (const [src, out, cssHeight] of CROPS) {
  const file = resolve("assets/screenshots", src);
  const buf = readFileSync(file);
  const w = width(buf);
  const cssWidth = w >= 2000 ? w / 2 : w; // dashboard shots were taken at 2x
  const page = await browser.newPage({ viewport: { width: cssWidth, height: cssHeight }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString("base64")}" style="display:block;width:${cssWidth}px"></body>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: `assets/readme/gallery/${out}`, clip: { x: 0, y: 0, width: cssWidth, height: cssHeight } });
  await page.close();
  console.log(`assets/readme/gallery/${out}`);
}
await browser.close();
