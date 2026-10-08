// Draws the README visuals into assets/readme/ from real sources only:
//   - site/data/showcase.json (tool output for the fictional demo organisation, see build-showcase.ts)
//   - the tool registry itself (tool counts per toolset)
//   npx tsx scripts/build-readme-visuals.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as toolsets from "../src/toolsets/index.js";

const show = JSON.parse(readFileSync("site/data/showcase.json", "utf8"));
const pulse = show.shots.pulse.data;
const backlog = show.shots.backlog.data;
const OUT = "assets/readme";
mkdirSync(OUT, { recursive: true });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SANS = "'Archivo', 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const D = { panel: "#16191d", row: "#1f2328", line: "#2b3036", ink: "#eef0f2", dim: "#a9afb6", hivis: "#cfee3a", ok: "#56c27a", risk: "#f0795c", warn: "#e9c25a", bar: "#4a525b" };
const L = { bg: "#fafafa", ink: "#1b1f24", ink2: "#575c63", line: "#e3e5e8", bar: "#c9cdd2" };
const frame = (w: number, h: number) =>
  `<rect width="${w}" height="${h}" rx="14" fill="${D.panel}"/><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>`;
const write = (name: string, svg: string) => {
  writeFileSync(`${OUT}/${name}`, svg);
  console.log(`${OUT}/${name}`);
};

// ---------------------------------------------------------------- banner (light + dark)
// Signature: the last 12 weeks of actions opened vs closed (demo org), as paired columns.
const weeks: Array<{ week_start: string; opened: number; closed: number }> = backlog.weekly.slice(-12);
function banner(theme: "light" | "dark") {
  const W = 1200;
  const H = 380;
  const bg = theme === "light" ? L.bg : "#0f1215";
  const ink = theme === "light" ? L.ink : D.ink;
  const ink2 = theme === "light" ? L.ink2 : D.dim;
  const ctx = theme === "light" ? L.bar : D.bar;
  const max = Math.max(...weeks.flatMap((w) => [w.opened, w.closed]));
  const cx = 760;
  const cw = 380;
  const base = 290;
  const ch = 170;
  const slot = cw / weeks.length;
  const bw = Math.floor(slot / 2) - 3;
  const bars = weeks
    .map((w, i) => {
      const x = cx + i * slot;
      const ho = Math.round((w.opened / max) * ch);
      const hc = Math.round((w.closed / max) * ch);
      return `<rect x="${x.toFixed(1)}" y="${base - ho}" width="${bw}" height="${ho}" rx="2" fill="${ctx}"/><rect x="${(x + bw + 2).toFixed(1)}" y="${base - hc}" width="${bw}" height="${hc}" rx="2" fill="${D.hivis}"/>`;
    })
    .join("");
  const totalOpen = weeks.reduce((a, w) => a + w.opened, 0);
  const totalClosed = weeks.reduce((a, w) => a + w.closed, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">SafetyCulture MCP</title>
<desc id="d">Ask your safety data anything. 126 tools for Mitti (formerly SafetyCulture). Chart: actions opened vs closed per week for the last 12 weeks in the fictional demo organisation, ${totalOpen} opened and ${totalClosed} closed.</desc>
<rect width="${W}" height="${H}" rx="18" fill="${bg}"/>
${theme === "light" ? `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${L.line}"/>` : ""}
<g font-family="${SANS}">
  <text x="64" y="92" font-family="${MONO}" font-size="15" fill="${ink2}">open-source MCP server  ·  Mitti (formerly SafetyCulture)</text>
  <text x="62" y="176" font-size="76" font-weight="800" letter-spacing="-1.5" fill="${ink}">SafetyCulture</text>
  <rect x="62" y="196" width="196" height="72" rx="4" fill="${D.hivis}"/>
  <text x="76" y="256" font-size="76" font-weight="800" letter-spacing="-1.5" fill="${L.ink}">MCP</text>
  <text x="282" y="246" font-size="26" font-weight="600" fill="${ink}">Ask your safety</text>
  <text x="282" y="278" font-size="26" font-weight="600" fill="${ink}">data anything.</text>
  <text x="64" y="330" font-family="${MONO}" font-size="15" fill="${ink2}">126 tools  ·  read-only by default  ·  reports, dashboards, BI exports  ·  demo mode</text>
</g>
<g font-family="${MONO}">
  <text x="${cx}" y="92" font-size="13" fill="${ink2}">actions per week, demo organisation</text>
  <rect x="${cx}" y="104" width="10" height="10" rx="2" fill="${ctx}"/><text x="${cx + 16}" y="114" font-size="13" fill="${ink2}">opened ${totalOpen}</text>
  <rect x="${cx + 120}" y="104" width="10" height="10" rx="2" fill="${D.hivis}"/><text x="${cx + 136}" y="114" font-size="13" fill="${ink2}">closed ${totalClosed}</text>
  ${bars}
  <line x1="${cx}" y1="${base + 0.5}" x2="${cx + cw}" y2="${base + 0.5}" stroke="${ink2}" stroke-opacity="0.5"/>
  <text x="${cx}" y="${base + 22}" font-size="12" fill="${ink2}">${esc(weeks[0]!.week_start)}</text>
  <text x="${cx + cw}" y="${base + 22}" font-size="12" text-anchor="end" fill="${ink2}">${esc(weeks[weeks.length - 1]!.week_start)}</text>
</g>
</svg>
`;
}
write("banner-light.svg", banner("light"));
write("banner-dark.svg", banner("dark"));

// ---------------------------------------------------------------- animated conversation
// A two-question exchange with the real tool output. Every element fades in on a 16 s loop.
const m = pulse.metrics;
const attention: Array<{ detail: string }> = pulse.attention ?? [];
const sites: Array<{ group: string; overdue: number; open: number }> = [...backlog.table].sort((a, b) => b.overdue - a.overdue).slice(0, 5);
const CYCLE = 16;
const items: Array<{ at: number; svg: string }> = [];
const add = (at: number, svg: string) => items.push({ at, svg });
const CW = 880;
const bubble = (y: number, text: string) => {
  const w = Math.min(560, 28 + text.length * 8.1);
  return `<g transform="translate(${CW - 32 - w},${y})"><rect width="${w}" height="40" rx="12" fill="${D.ink}"/><text x="16" y="26" font-family="${SANS}" font-size="15" fill="${L.ink}">${esc(text)}</text></g>`;
};
const chip = (y: number, tool: string, args: string) =>
  `<g transform="translate(32,${y})"><rect width="${tool.length * 8.4 + args.length * 7.4 + 64}" height="28" rx="14" fill="none" stroke="${D.line}"/><circle cx="16" cy="14" r="5" fill="${D.hivis}"/><text x="30" y="19" font-family="${MONO}" font-size="13" fill="${D.ink}">${esc(tool)}<tspan fill="${D.dim}">  ${esc(args)}</tspan></text></g>`;
const kpi = (x: number, y: number, label: string, value: string, note: string, tone: string) =>
  `<g transform="translate(${x},${y})"><rect width="196" height="78" rx="8" fill="${D.row}" stroke="${D.line}"/><text x="14" y="24" font-family="${SANS}" font-size="12.5" fill="${D.dim}">${esc(label)}</text><text x="14" y="52" font-family="${SANS}" font-size="24" font-weight="700" fill="${D.ink}">${esc(value)}</text><text x="14" y="69" font-family="${MONO}" font-size="11" fill="${tone}">${esc(note)}</text></g>`;
const row = (t: Record<string, { delta: number; previous: number }>, k: string) => t[k];
const tbl = Object.fromEntries((pulse.table as Array<{ metric: string; delta: number; previous: number }>).map((r) => [r.metric, r]));
const dn = (k: string, worseUp: boolean, unit = "") => {
  const r = row(tbl, k);
  if (!r) return { note: "", tone: D.dim };
  const worse = worseUp ? r.delta > 0 : r.delta < 0;
  return { note: `${r.delta > 0 ? "+" : ""}${r.delta}${unit} vs ${r.previous}`, tone: r.delta === 0 ? D.dim : worse ? D.risk : D.ok };
};
add(0.4, bubble(74, "Give me the Monday safety pulse."));
add(1.4, chip(130, "sc_safety_pulse", 'period: "last 7 days"'));
const k1 = dn("inspections_completed", false);
const k2 = dn("average_score", false, " pp");
const k3 = dn("failed_item_rate", true, " pp");
add(2.2, kpi(32, 172, "Inspections", String(m.inspections_completed), k1.note, k1.tone));
add(2.4, kpi(240, 172, "Average score", `${m.average_score}%`, k2.note, k2.tone));
add(2.6, kpi(448, 172, "Failed-item rate", `${m.failed_item_rate}%`, k3.note, k3.tone));
add(2.8, kpi(656, 172, "Overdue actions", String(m.open_overdue_actions), `oldest ${m.max_days_overdue} days`, D.warn));
attention.slice(0, 2).forEach((a, i) => {
  const text = a.detail.length > 96 ? `${a.detail.slice(0, 93)}...` : a.detail;
  add(3.4 + i * 0.3, `<g transform="translate(32,${266 + i * 36})"><rect width="${CW - 64}" height="28" rx="6" fill="${D.row}"/><circle cx="14" cy="14" r="4.5" fill="${D.hivis}"/><text x="28" y="19" font-family="${SANS}" font-size="13" fill="${D.ink}">${esc(text)}</text></g>`);
});
add(5.6, bubble(354, "Which sites have the most overdue actions?"));
add(6.6, chip(410, "sc_analyze_action_backlog", 'group_by: "site"'));
const maxO = Math.max(...sites.map((s) => s.overdue));
sites.forEach((s, i) => {
  const w = Math.round((s.overdue / maxO) * 440);
  add(
    7.4 + i * 0.2,
    `<g transform="translate(32,${452 + i * 26})"><text x="0" y="15" font-family="${SANS}" font-size="13" fill="${D.dim}">${esc(s.group)}</text><rect x="190" y="3" width="${w}" height="16" rx="3" fill="${i === 0 ? D.hivis : D.bar}"/><text x="${198 + w}" y="16" font-family="${MONO}" font-size="12" fill="${D.ink}">${s.overdue} overdue of ${s.open} open</text></g>`,
  );
});
const CH = 452 + sites.length * 26 + 30;
const pct = (s: number) => ((s / CYCLE) * 100).toFixed(2);
const keyframes = items
  .map((it, i) => `@keyframes k${i}{0%,${pct(it.at)}%{opacity:0;transform:translateY(6px)}${pct(it.at + 0.35)}%,93%{opacity:1;transform:none}100%{opacity:0}}.e${i}{animation:k${i} ${CYCLE}s ease-out infinite both}`)
  .join("");
write(
  "conversation.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" role="img" aria-labelledby="t d">
<title id="t">Asking the MCP server two questions</title>
<desc id="d">"Give me the Monday safety pulse." The server calls sc_safety_pulse and answers: ${m.inspections_completed} inspections, average score ${m.average_score}%, failed-item rate ${m.failed_item_rate}%, ${m.open_overdue_actions} overdue actions. "Which sites have the most overdue actions?" The server calls sc_analyze_action_backlog: ${sites.map((s) => `${s.group} ${s.overdue}`).join(", ")}. Demo organisation, real tool output.</desc>
<style>${keyframes}@media (prefers-reduced-motion: reduce){[class^=e]{animation:none!important;opacity:1!important}}</style>
${frame(CW, CH)}
<circle cx="36" cy="36" r="5" fill="${D.hivis}"/><text x="50" y="41" font-family="${MONO}" font-size="13" fill="${D.dim}">your AI client  ·  safetyculture-mcp  ·  demo organisation</text>
${items.map((it, i) => `<g class="e${i}">${it.svg}</g>`).join("\n")}
</svg>
`,
);

// ---------------------------------------------------------------- toolsets map
const all = Object.values(toolsets).flat().filter((t): t is { toolset: string } => Boolean(t && typeof t === "object" && "toolset" in t));
const counts = new Map<string, number>();
for (const t of all) counts.set(t.toolset, (counts.get(t.toolset) ?? 0) + 1);
const rowsT = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const highlight = new Set(["analytics", "reports", "feeds", "integrations"]);
const TW = 880;
const RH = 24;
const TH = 96 + rowsT.length * RH + 40;
const tmax = Math.max(...rowsT.map(([, n]) => n));
const total = all.length + 2; // + sc_list_toolsets and sc_enable_toolsets (registered in server.ts)
write(
  "toolsets.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}" role="img" aria-labelledby="t d">
<title id="t">${total} tools in ${rowsT.length} toolsets</title>
<desc id="d">${rowsT.map(([k, n]) => `${k} ${n}`).join(", ")}, plus 2 meta tools to list and enable toolsets.</desc>
${frame(TW, TH)}
<text x="32" y="48" font-family="${SANS}" font-size="22" font-weight="700" fill="${D.ink}">${total} tools in ${rowsT.length} toolsets</text>
<text x="32" y="72" font-family="${MONO}" font-size="12.5" fill="${D.dim}">highlighted: the local cache, analytics, reports and integrations that go beyond raw API calls</text>
${rowsT
  .map(([k, n], i) => {
    const y = 96 + i * RH;
    const w = Math.round((n / tmax) * 560);
    return `<g transform="translate(32,${y})"><text x="0" y="15" font-family="${MONO}" font-size="13" fill="${highlight.has(k) ? D.ink : D.dim}">${esc(k)}</text><rect x="150" y="3" width="${w}" height="15" rx="3" fill="${highlight.has(k) ? D.hivis : D.bar}"/><text x="${158 + w}" y="15" font-family="${MONO}" font-size="12" fill="${D.ink}">${n}</text></g>`;
  })
  .join("\n")}
<text x="32" y="${TH - 18}" font-family="${MONO}" font-size="11.5" fill="${D.dim}">counted from the tool registry  ·  plus sc_list_toolsets and sc_enable_toolsets</text>
</svg>
`,
);

// ---------------------------------------------------------------- architecture
const AW = 880;
const AH = 380;
const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], accent = false) =>
  `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="10" fill="${D.row}" stroke="${accent ? D.hivis : D.line}"/><text x="16" y="28" font-family="${SANS}" font-size="15" font-weight="700" fill="${D.ink}">${esc(title)}</text>${lines
    .map((l, i) => `<text x="16" y="${52 + i * 20}" font-family="${MONO}" font-size="12" fill="${D.dim}">${esc(l)}</text>`)
    .join("")}</g>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, label = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${D.dim}" stroke-width="1.5" marker-end="url(#a)"/>${label ? `<text x="${(x1 + x2) / 2}" y="${Math.min(y1, y2) - 8}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${D.dim}">${esc(label)}</text>` : ""}`;
write(
  "architecture.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${AW}" height="${AH}" viewBox="0 0 ${AW} ${AH}" role="img" aria-labelledby="t d">
<title id="t">How it works</title>
<desc id="d">Your AI client talks MCP (stdio or Streamable HTTP) to safetyculture-mcp on your machine. The server checks the mode, masks personal data and wraps record text as untrusted, then calls the Mitti API with your token. A local SQLite cache feeds analytics, reports, dashboards and Power BI or Qlik exports.</desc>
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${D.dim}"/></marker></defs>
${frame(AW, AH)}
<text x="32" y="44" font-family="${SANS}" font-size="20" font-weight="700" fill="${D.ink}">How it works</text>
${box(32, 72, 196, 150, "Your AI client", ["Claude Desktop / Code", "ChatGPT, Codex", "Cursor, VS Code", "any MCP client"])}
${box(300, 72, 280, 150, "safetyculture-mcp", ["read-only unless SC_MODE", "dry run + confirm token", "personal data masked", "untrusted-data envelope"], true)}
${box(652, 72, 196, 150, "Mitti API", ["api.mitti.com", "your API token", "your permissions"])}
${arrow(230, 147, 296, 147, "MCP")}
${arrow(582, 147, 648, 147, "HTTPS")}
${box(300, 252, 280, 100, "Local cache (SQLite)", ["incremental sync, on your disk", "13 analyses, fail closed"])}
${box(652, 252, 196, 100, "Files you keep", ["reports, dashboards", "Power BI / Qlik / CSV"])}
${arrow(440, 224, 440, 248)}
${arrow(582, 302, 648, 302)}
</svg>
`,
);

// ---------------------------------------------------------------- safety modes
const SW = 880;
const SH = 250;
const mode = (x: number, title: string, sub: string, lines: string[], on: boolean) =>
  `<g transform="translate(${x},84)"><rect width="260" height="140" rx="10" fill="${D.row}" stroke="${on ? D.hivis : D.line}"/>${on ? `<rect x="16" y="16" width="64" height="20" rx="10" fill="${D.hivis}"/><text x="48" y="30" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${L.ink}">default</text>` : ""}<text x="16" y="${on ? 62 : 40}" font-family="${MONO}" font-size="15" fill="${D.ink}">${esc(title)}</text><text x="16" y="${on ? 82 : 60}" font-family="${SANS}" font-size="12.5" fill="${D.dim}">${esc(sub)}</text>${lines
    .map((l, i) => `<text x="16" y="${(on ? 106 : 86) + i * 18}" font-family="${SANS}" font-size="12.5" fill="${D.ink}">${esc(l)}</text>`)
    .join("")}</g>`;
write(
  "safety-modes.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" role="img" aria-labelledby="t d">
<title id="t">Three modes, safe by default</title>
<desc id="d">SC_MODE=read-only (default): reads, analytics and reports only. SC_MODE=write: create and update records; every write is audited. SC_MODE=full: deletes and bulk changes run a dry run first and need a single-use confirm token bound to the exact arguments.</desc>
${frame(SW, SH)}
<text x="32" y="44" font-family="${SANS}" font-size="20" font-weight="700" fill="${D.ink}">Three modes, safe by default</text>
<text x="32" y="66" font-family="${MONO}" font-size="12" fill="${D.dim}">you choose with SC_MODE; the AI cannot switch it</text>
${mode(32, "read-only", "reads, analytics, reports", ["writes refused", "nothing changes in Mitti"], true)}
${mode(310, "write", "create and update", ["new actions, issues, notes", "every write in a local audit log"], false)}
${mode(588, "full", "deletes and bulk changes", ["dry run shows the plan first", "then a single-use confirm token"], false)}
${arrow(294, 154, 306, 154)}
${arrow(572, 154, 584, 154)}
</svg>
`,
);
