// Dev utility: full-page screenshots of local HTML files for docs.
//   node scripts/shoot.mjs <file.html> <out.png> [width=1280] [fullPage=true]
// Uses playwright-core from $PLAYWRIGHT_CORE (default: the estate's gate-l0 tool) and a Chrome at $CHROME.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/src/tools/gate-l0/node_modules/playwright-core");
const chrome =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);

const [file, out, width = "1280", full = "true", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
const target = /^https?:/.test(file) ? file : pathToFileURL(resolve(file)).href;
await page.goto(target, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: full === "true" });
await browser.close();
console.log(`saved ${out}`);
