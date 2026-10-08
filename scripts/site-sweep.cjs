// site-sweep.cjs: acceptance sweep for TICKET SITE-FIX-1.
// Launches Chromium via playwright-core, loads site/index.html from disk,
// asserts the ticket's acceptance checks. Exit 1 on any failure, prints a table.
"use strict";

const path = require("path");

const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || "playwright-core";
const EXECUTABLE = process.env.GATE_BROWSER || process.env.CHROME || undefined;

let chromium;
try {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  ({ chromium } = require(PLAYWRIGHT_CORE));
} catch (e) {
  console.error(`Cannot require playwright-core via "${PLAYWRIGHT_CORE}": ${e.message}`);
  process.exit(1);
}

const FILE_URL = "file://" + path.resolve(__dirname, "..", "site", "index.html");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
  tiny: { width: 320, height: 640 },
};

const rows = [];
function check(name, viewport, pass, detail) {
  rows.push({ name, viewport, pass: Boolean(pass), detail: String(detail || "") });
}

async function newPage(browser, vp, opts) {
  const context = await browser.newContext({
    viewport: vp,
    reducedMotion: (opts && opts.reducedMotion) || "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 300)));
  await page.goto(FILE_URL, { waitUntil: "load", timeout: 60000 });
  try {
    await page.evaluate(() => Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((res) => setTimeout(res, 4000)),
    ]));
  } catch (e) {}
  await page.waitForTimeout(2200);
  return { context, page, errors };
}

async function evalOverflow(page) {
  return page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
}

async function evalH1(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1");
    if (!h1) return { ok: false, detail: "no h1" };
    const r = h1.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    if (!lh) return { ok: false, detail: "line-height not resolved" };
    const lines = Math.round(r.height / lh);
    return { lines, height: r.height, lineHeight: lh };
  });
}

async function evalTextChecks(page) {
  return page.evaluate(() => {
    function parse(s) {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x.trim()));
      if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
      return [p[0], p[1], p[2], p.length >= 4 ? p[3] : 1];
    }
    function ratio(fg, bg) {
      const l1 = (function (rgb) {
        const f = (c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
      })(fg);
      const l2 = (function (rgb) {
        const f = (c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
      })(bg);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }
    function visible(el) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity) < 0.01) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      if (el.closest("[hidden]")) return false;
      return true;
    }
    function bgOf(el) {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] >= 0.99) return [c[0], c[1], c[2]];
        n = n.parentElement;
      }
      const root = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (root && root[3] >= 0.99) return [root[0], root[1], root[2]];
      const body = parse(getComputedStyle(document.body).backgroundColor);
      if (body) return [body[0], body[1], body[2]];
      return [255, 255, 255];
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    const nodes = [];
    let t;
    while ((t = walker.nextNode())) {
      if (!t.nodeValue || !t.nodeValue.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el)) continue;
      if (el.closest("script,style")) continue;
      seen.add(el);
      nodes.push(el);
    }
    const fails = [];
    const small = [];
    nodes.forEach((el) => {
      if (!visible(el)) return;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const label = (el.tagName + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " \"" + (el.textContent || "").trim().slice(0, 40) + "\"");
      if (fs < 11) small.push(label + " " + cs.fontSize);
      const fg = parse(cs.color);
      if (!fg) return;
      const bg = bgOf(el);
      const r = ratio([fg[0], fg[1], fg[2]], bg);
      const w = cs.fontWeight;
      const bold = w === "bold" || w === "bolder" || parseFloat(w) >= 700;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (r < need - 1e-9) fails.push(label + " " + r.toFixed(2) + ":1 need " + need + " (" + cs.fontSize + ")");
    });
    return { fails: fails.slice(0, 20), failCount: fails.length, small: small.slice(0, 20), smallCount: small.length };
  });
}

async function evalTapTargets(page) {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a,button,summary,[role=tab]"));
    const bad = [];
    els.forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      if (el.closest("[hidden]")) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.bottom < 0 || r.top > window.innerHeight + 2000) return;
      if (r.height >= 44) return;
      if (cs.display === "inline" && el.closest("p")) return;
      const txt = (el.textContent || "").trim().slice(0, 40);
      bad.push(el.tagName + "." + (el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " \"" + txt + "\" " + Math.round(r.width) + "x" + Math.round(r.height));
    });
    return bad.slice(0, 20).concat(bad.length > 20 ? ["... +" + (bad.length - 20) + " more"] : []);
  });
}

async function evalTabs(page, vw) {
  return page.evaluate((w) => {
    const tabs = Array.from(document.querySelectorAll('[role=tab]'));
    const out = tabs.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || "").trim().slice(0, 20), l: Math.round(r.left), rgt: Math.round(r.right), ok: r.left >= -1 && r.right <= w + 1 };
    });
    return { count: tabs.length, tabs: out, allOk: out.length === 7 && out.every((x) => x.ok) };
  }, vw);
}

async function evalRisk(page) {
  return page.evaluate(() => {
    const td = document.querySelector(".ptable td.is-worse");
    if (!td) return { ok: false, detail: "no .ptable td.is-worse" };
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--risk)";
    probe.textContent = "x";
    document.body.appendChild(probe);
    const a = getComputedStyle(td).color;
    const b = getComputedStyle(probe).color;
    probe.remove();
    return { ok: a === b, detail: "td=" + a + " token=" + b };
  });
}

async function evalHero(page) {
  return page.evaluate(() => {
    const p = document.querySelector(".hero-panel .panel");
    if (!p) return { ok: false, detail: "no hero panel" };
    const h = p.getBoundingClientRect().height;
    return { height: Math.round(h) };
  });
}

async function evalReduced(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
    if (el.closest("script,style")) return false;
    if (!el.textContent || !el.textContent.trim()) return false;
    return getComputedStyle(el).opacity === "0";
  }).slice(0, 10).map((el) => el.tagName + "." + (el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")));
}

(async () => {
  const launchOpts = { headless: true };
  if (EXECUTABLE) launchOpts.executablePath = EXECUTABLE;
  const browser = await chromium.launch(launchOpts);
  const allErrors = [];
  try {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const { context, page, errors } = await newPage(browser, vp);
      try {
        const o = await evalOverflow(page);
        check("no horizontal overflow", name, o.sw <= o.cw, `scrollWidth=${o.sw} clientWidth=${o.cw}`);
        if (name === "desktop" || name === "mobile") {
          const h = await evalH1(page);
          check("h1 <= 3 lines", name, h.lines !== undefined && h.lines <= 3, h.lines !== undefined ? `lines=${h.lines} (${Math.round(h.height)}/${h.lineHeight.toFixed(1)}px)` : h.detail);
          const t = await evalTextChecks(page);
          check("text contrast >= 4.5:1 (3:1 large)", name, t.failCount === 0, t.failCount === 0 ? "all pass" : t.fails.join(" | "));
          check("no text below 11px", name, t.smallCount === 0, t.smallCount === 0 ? "none" : t.small.join(" | "));
        }
        if (name === "mobile") {
          const bad = await evalTapTargets(page);
          check("tap targets >= 44px", name, bad.length === 0, bad.length === 0 ? "all pass" : bad.join(" | "));
          const tb = await evalTabs(page, vp.width);
          check("all 7 tabs in viewport", name, tb.allOk, `count=${tb.count} ` + tb.tabs.map((x) => `${x.text}[${x.l}-${x.rgt}]`).join(" "));
        }
        if (name === "desktop") {
          const rk = await evalRisk(page);
          check("td.is-worse uses --risk", name, rk.ok, rk.detail);
          const hp = await evalHero(page);
          check("hero panel <= 680px", name, hp.height !== undefined && hp.height <= 680, hp.height !== undefined ? `height=${hp.height}px` : hp.detail);
        }
      } finally {
        allErrors.push(...errors.map((e) => `[${name}] ${e}`));
        await context.close();
      }
    }
    const { context, page, errors } = await newPage(browser, VIEWPORTS.desktop, { reducedMotion: "reduce" });
    try {
      const zero = await evalReduced(page);
      check("reduced-motion: no opacity-0 text", "reduce", zero.length === 0, zero.length === 0 ? "none" : zero.join(" | "));
    } finally {
      allErrors.push(...errors.map((e) => `[reduce] ${e}`));
      await context.close();
    }
    check("no console errors", "all", allErrors.length === 0, allErrors.length === 0 ? "clean" : allErrors.slice(0, 10).join(" | "));
  } finally {
    await browser.close();
  }
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("| " + w("CHECK", 38) + " | " + w("VIEW", 8) + " | " + w("RESULT", 6) + " | DETAIL");
  console.log("|" + "-".repeat(40) + "|" + "-".repeat(10) + "|" + "-".repeat(8) + "|-------");
  let fails = 0;
  for (const r of rows) {
    if (!r.pass) fails += 1;
    console.log("| " + w(r.name, 38) + " | " + w(r.viewport, 8) + " | " + w(r.pass ? "PASS" : "FAIL", 6) + " | " + r.detail);
  }
  console.log(fails === 0 ? `\nSWEEP PASS (${rows.length}/${rows.length})` : `\nSWEEP FAIL (${fails}/${rows.length} failed)`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error("SWEEP ERROR: " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
