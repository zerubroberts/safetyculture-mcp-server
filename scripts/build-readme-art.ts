// Draws assets/hero.svg (an "instrument panel" of the real sc_safety_pulse output) from
// site/data/showcase.json, which build-showcase.ts produces from the fictional demo org only.
//   npx tsx scripts/build-readme-art.ts
import { readFileSync, writeFileSync } from "node:fs";

interface Row { metric: string; current: number; previous: number; delta: number; direction: string }
const show = JSON.parse(readFileSync("site/data/showcase.json", "utf8"));
const pulse = show.shots.pulse;
const rows: Row[] = pulse.data.table;
const attention: Array<{ detail: string }> = pulse.data.attention ?? [];
const m = pulse.data.metrics;
const period: string = pulse.data.period.label;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const C = { panel: "#16191d", row: "#1f2328", line: "#2b3036", ink: "#eef0f2", dim: "#a9afb6", hivis: "#cfee3a", ok: "#56c27a", risk: "#f0795c", warn: "#e9c25a" };
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'Archivo', 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";

// Higher is worse for these metrics.
const worseWhenUp = new Set(["failed_item_rate", "open_overdue_actions", "missed_scheduled_inspections", "new_issues"]);
const tile = (r: Row | undefined, label: string, value: string, x: number, y: number, fixedNote = "") => {
  let note = fixedNote;
  let color = C.dim;
  if (r) {
    if (r.direction === "too few to compare") note = "too few to compare";
    else {
      const up = r.delta > 0;
      const worse = worseWhenUp.has(r.metric) ? up : !up && r.delta !== 0;
      color = r.delta === 0 ? C.dim : worse ? C.risk : C.ok;
      const sign = r.delta > 0 ? "+" : "";
      const unit = r.metric.includes("rate") || r.metric.includes("score") ? " pp" : "";
      note = `${sign}${r.delta}${unit} vs ${r.previous}${r.delta === 0 ? "" : worse ? "  worse" : "  better"}`;
    }
  }
  return `<g transform="translate(${x},${y})">
  <rect width="196" height="96" rx="8" fill="${C.row}" stroke="${C.line}"/>
  <text x="16" y="28" font-family="${SANS}" font-size="13" fill="${C.dim}">${esc(label)}</text>
  <text x="16" y="62" font-family="${SANS}" font-size="30" font-weight="700" fill="${C.ink}">${esc(value)}</text>
  <text x="16" y="84" font-family="${MONO}" font-size="11.5" fill="${color}">${esc(note)}</text>
</g>`;
};
const find = (k: string) => rows.find((r) => r.metric === k);

const W = 880;
const H = 430;
const tiles = [
  tile(find("inspections_completed"), "Inspections completed", String(m.inspections_completed), 32, 92),
  tile(find("average_score"), "Average score", `${m.average_score}%`, 240, 92),
  tile(find("failed_item_rate"), "Failed-item rate", `${m.failed_item_rate}%`, 448, 92),
  tile(undefined, "Open overdue actions", String(m.open_overdue_actions), 656, 92, `oldest ${m.max_days_overdue} days overdue`),
].join("\n");

const att = attention
  .slice(0, 3)
  .map((a, i) => {
    const text = a.detail.length > 112 ? `${a.detail.slice(0, 109)}...` : a.detail;
    return `<g transform="translate(32,${262 + i * 40})">
  <rect width="${W - 64}" height="32" rx="6" fill="${C.row}"/>
  <circle cx="16" cy="16" r="5" fill="${C.hivis}"/>
  <text x="32" y="21" font-family="${SANS}" font-size="13.5" fill="${C.ink}">${esc(text)}</text>
</g>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">sc_safety_pulse output for the demo organisation</title>
<desc id="d">${esc(pulse.summary)}</desc>
<rect width="${W}" height="${H}" rx="14" fill="${C.panel}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
<circle cx="36" cy="38" r="5" fill="${C.hivis}"/>
<text x="52" y="43" font-family="${MONO}" font-size="14" font-weight="500" fill="${C.ink}">sc_safety_pulse</text>
<text x="196" y="43" font-family="${MONO}" font-size="13" fill="${C.dim}">period: "last 7 days"</text>
<rect x="${W - 196}" y="24" width="164" height="26" rx="13" fill="none" stroke="${C.line}"/>
<text x="${W - 114}" y="41" text-anchor="middle" font-family="${MONO}" font-size="11.5" fill="${C.dim}">demo organisation</text>
<text x="32" y="74" font-family="${SANS}" font-size="13" fill="${C.dim}">${esc(period)} vs the 7 days before</text>
${tiles}
<text x="32" y="240" font-family="${SANS}" font-size="15" font-weight="700" fill="${C.ink}">Needs attention today</text>
${att}
<text x="32" y="${H - 22}" font-family="${MONO}" font-size="11" fill="${C.dim}">failed-item rate = ${m.failed_items} failed / ${m.answered_items} answered items  ·  ${m.missed_scheduled_inspections} missed scheduled inspections  ·  ${m.actions_created} actions created, ${m.actions_completed} completed</text>
</svg>
`;
writeFileSync("assets/hero.svg", svg);
console.log("assets/hero.svg written");
