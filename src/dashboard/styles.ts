/**
 * Dashboard stylesheet. Tokens follow DESIGN.md (OKLCH, graphite ink at hue 250, one hi-vis accent at
 * 122/128, risk red at 27). The dark theme is its own palette, not an inversion: near-black panel surfaces,
 * brighter and slightly desaturated data colours, quieter gridlines. System fonts only: no web fonts, so the
 * file never makes a request.
 */
export const CSS = String.raw`
:root{
  --bg:oklch(0.985 0 0);--surface:oklch(1 0 0);--surface-2:oklch(0.97 0.003 250);--line:oklch(0.9 0.006 250);--grid:oklch(0.935 0.004 250);
  --ink:oklch(0.21 0.012 250);--ink-2:oklch(0.43 0.01 250);--ink-3:oklch(0.56 0.01 250);
  --mark:oklch(0.3 0.012 250);--mark-soft:oklch(0.8 0.008 250);--band:oklch(0.91 0.2 122 / 0.16);
  --accent:oklch(0.91 0.2 122);--accent-ink:oklch(0.5 0.14 130);--on-accent:oklch(0.21 0.012 250);
  --ok:oklch(0.55 0.13 150);--warn:oklch(0.66 0.15 70);--risk:oklch(0.57 0.19 27);--risk-soft:oklch(0.57 0.19 27 / 0.12);
  --risk-ink:oklch(0.47 0.17 27);--warn-ink:oklch(0.46 0.1 62);--warn-soft:oklch(0.8 0.15 80 / 0.2);
  --c0:oklch(0.95 0.004 250);--c1:oklch(0.94 0.06 122);--c2:oklch(0.86 0.13 122);--c3:oklch(0.73 0.15 128);--c4:oklch(0.58 0.13 134);--c5:oklch(0.44 0.1 140);
  --s0:oklch(0.93 0.008 250);--s1:oklch(0.88 0.05 60);--s2:oklch(0.79 0.1 48);--s3:oklch(0.67 0.15 36);--s4:oklch(0.54 0.18 28);
  --tip-bg:oklch(0.2 0.012 250);--tip-ink:oklch(0.95 0.005 250);--tip-dim:oklch(0.76 0.01 250);
  --shadow:0 1px 0 var(--line),0 18px 40px -24px oklch(0.2 0.01 250 / 0.25);
  --sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
  --display:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
  color-scheme:light;
}
:root[data-theme="dark"]{
  --bg:oklch(0.165 0.01 250);--surface:oklch(0.205 0.012 250);--surface-2:oklch(0.235 0.012 250);--line:oklch(1 0 0 / 0.09);--grid:oklch(1 0 0 / 0.06);
  --ink:oklch(0.95 0.005 250);--ink-2:oklch(0.76 0.01 250);--ink-3:oklch(0.62 0.01 250);
  --mark:oklch(0.88 0.008 250);--mark-soft:oklch(0.42 0.012 250);--band:oklch(0.91 0.2 122 / 0.09);
  --accent:oklch(0.91 0.2 122);--accent-ink:oklch(0.89 0.18 122);--on-accent:oklch(0.21 0.012 250);
  --ok:oklch(0.76 0.14 150);--warn:oklch(0.83 0.13 80);--risk:oklch(0.72 0.16 28);--risk-soft:oklch(0.72 0.16 28 / 0.16);
  --risk-ink:oklch(0.78 0.14 28);--warn-ink:oklch(0.86 0.12 82);--warn-soft:oklch(0.83 0.13 80 / 0.14);
  --c0:oklch(0.25 0.01 250);--c1:oklch(0.34 0.06 130);--c2:oklch(0.46 0.1 128);--c3:oklch(0.6 0.14 125);--c4:oklch(0.75 0.17 123);--c5:oklch(0.89 0.19 122);
  --s0:oklch(0.29 0.01 250);--s1:oklch(0.4 0.06 55);--s2:oklch(0.5 0.1 45);--s3:oklch(0.6 0.14 35);--s4:oklch(0.7 0.17 28);
  --tip-bg:oklch(0.27 0.012 250);--tip-ink:oklch(0.96 0.005 250);--tip-dim:oklch(0.78 0.01 250);
  --shadow:0 0 0 1px oklch(1 0 0 / 0.06),0 18px 40px -24px oklch(0 0 0 / 0.6);
  color-scheme:dark;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:inherit}
button,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;box-shadow:0 0 0 7px oklch(0.91 0.2 122 / 0.55);border-radius:6px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:12px;top:-60px;z-index:20;background:var(--ink);color:var(--bg);padding:8px 12px;border-radius:8px;text-decoration:none}
.skip:focus{top:12px}

/* ---------- frame ---------- */
.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.nav{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:18px;padding:22px 16px 18px;border-right:1px solid var(--line);background:var(--bg)}
.brand{display:flex;flex-direction:column;gap:6px;padding:0 8px}
.brand .tool{font:500 11px/1 var(--mono);color:var(--ink-2);letter-spacing:.02em;display:flex;align-items:center;gap:8px}
.brand .tool i{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 1px oklch(0.21 0.012 250 / 0.2)}
.brand b{font:700 19px/1.15 var(--display);letter-spacing:-.01em}
.brand .org{font:400 12px/1.4 var(--sans);color:var(--ink-2)}
.brand .org code{font:500 11.5px var(--mono);color:var(--ink)}
.nav ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.nav a.item{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:8px;min-height:40px;padding:8px 10px;border-radius:8px;text-decoration:none;color:var(--ink-2);font-weight:500}
.nav a.item:hover{background:var(--surface-2);color:var(--ink)}
.nav a.item[aria-current="page"]{background:var(--surface);color:var(--ink);font-weight:650;box-shadow:0 0 0 1px var(--line)}
.nav a.item .pip{width:8px;height:8px;border-radius:999px;background:transparent;box-shadow:inset 0 0 0 1.5px var(--ink-3);justify-self:center}
.nav a.item[aria-current="page"] .pip{background:var(--accent);box-shadow:0 0 0 1px oklch(0.21 0.012 250 / 0.25)}
.nav .count{font:500 11px/1 var(--mono);padding:4px 6px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}
.nav .count.risk{background:var(--risk-soft);color:var(--risk)}
.nav .foot{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding:0 4px}
.nav .foot button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px}
.nav .foot button:hover{border-color:var(--ink-3)}
.nav .foot .k{font:500 11px var(--mono);color:var(--ink-2)}
.nav .fine{font-size:11.5px;color:var(--ink-3);line-height:1.45;padding:0 6px}

.main{min-width:0;padding:0 40px 64px}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:14px 0 12px;background:var(--bg);border-bottom:1px solid var(--line)}
.seg{display:inline-flex;padding:3px;border-radius:9px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}
.seg button{min-height:36px;min-width:48px;padding:0 12px;border:0;border-radius:7px;background:transparent;cursor:pointer;font:500 13px var(--mono);color:var(--ink-2)}
.seg button[aria-pressed="true"]{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 2px oklch(0.2 0.01 250 / 0.12),0 0 0 1px var(--line)}
.sel{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2)}
.sel select{min-height:40px;max-width:260px;padding:0 34px 0 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--ink-2) 50%),linear-gradient(135deg,var(--ink-2) 50%,transparent 50%);background-position:calc(100% - 17px) 17px,calc(100% - 12px) 17px;background-size:5px 5px;background-repeat:no-repeat}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 6px 4px 10px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:12.5px;color:var(--ink-2)}
.chip b{color:var(--ink);font-weight:600}
.chip button{display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:var(--surface-2);cursor:pointer;color:var(--ink-2);font-size:14px;line-height:1}
.chip button:hover{background:var(--ink);color:var(--bg)}
.chip.static{padding-right:10px}

/* ---------- view ---------- */
.view{padding-top:26px;animation:rise .22s ease-out both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.head{display:grid;gap:6px;margin:0 0 22px;max-width:980px}
.eyebrow{font:500 11px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--ink-2)}
h1{font:700 30px/1.08 var(--display);letter-spacing:-.018em;margin:0;text-wrap:balance}
.question{margin:0;font-size:16px;color:var(--ink-2);text-wrap:pretty}
.answer{margin:10px 0 0;font:600 19px/1.4 var(--display);letter-spacing:-.005em;color:var(--ink);text-wrap:pretty;max-width:74ch}
.answer mark{background:var(--accent);color:var(--on-accent);padding:0 .14em;border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.grid{display:grid;gap:16px;grid-template-columns:repeat(12,minmax(0,1fr));margin-bottom:16px}
.span-12{grid-column:span 12}.span-7{grid-column:span 7}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-4{grid-column:span 4}.span-8{grid-column:span 8}
.card{min-width:0;background:var(--surface);border-radius:10px;box-shadow:var(--shadow);padding:18px 20px 16px}
.card h2{font:650 15px/1.3 var(--sans);margin:0;letter-spacing:-.003em}
.card .sub{margin:3px 0 0;font-size:12.5px;color:var(--ink-2);text-wrap:pretty}
.card .chart{margin-top:12px;position:relative;min-height:40px}
.card .chart:focus-visible{border-radius:8px}
.card .foot{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.card .foot b{color:var(--ink);font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 0;padding:0;list-style:none;font-size:12px;color:var(--ink-2)}
.legend li{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px}
.sw.ring{border-radius:999px;background:transparent!important;box-shadow:inset 0 0 0 2px currentColor}
.sw.dot{border-radius:999px}
.unavail{display:grid;gap:4px;padding:14px 16px;border-radius:8px;background:var(--surface-2);color:var(--ink-2);font-size:13px}
.unavail b{font:600 11px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--ink)}

/* tiles */
.tiles{display:grid;gap:12px;grid-template-columns:repeat(6,minmax(0,1fr));margin:0 0 16px}
.tiles.n4{grid-template-columns:repeat(4,minmax(0,1fr))}.tiles.n5{grid-template-columns:repeat(5,minmax(0,1fr))}
.tile{min-width:0;display:flex;flex-direction:column;gap:2px;background:var(--surface);border-radius:10px;box-shadow:var(--shadow);padding:14px 16px 12px;position:relative}
.tile .l{font-size:12.5px;color:var(--ink-2);line-height:1.3;min-height:2.6em}
.tile .v{font:650 28px/1.1 var(--display);letter-spacing:-.02em;margin-top:2px}
.tile .v small{font:500 15px var(--sans);color:var(--ink-2);margin-left:1px}
.tile .v.na{font:600 15px/1.6 var(--sans);color:var(--ink-2);letter-spacing:0}
.tile .d{font-size:12px;color:var(--ink-2);line-height:1.35;min-height:1.35em}
.tile .d.better{color:var(--ok)}.tile .d.worse{color:var(--risk)}
.tile .d .ar{font-size:10px;margin-right:2px}
.tile .spark{margin-top:8px;height:28px}
.tile .spark svg{display:block;width:100%;height:28px;overflow:visible}

/* attention */
.att{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.att li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:10px 12px;border-radius:8px;background:var(--surface-2)}
.att .sev{font:600 11px/1 var(--mono);padding:5px 7px;border-radius:999px;background:var(--risk-soft);color:var(--risk-ink);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.att .sev.s2,.att .sev.s3{background:var(--warn-soft);color:var(--warn-ink)}
.att .sev.s4{background:var(--surface);color:var(--ink-2);box-shadow:inset 0 0 0 1px var(--line)}
.att p{margin:0;font-size:13px;line-height:1.45}
.att a{color:var(--accent-ink);font-weight:600;text-decoration:none;white-space:nowrap}
.att a:hover{text-decoration:underline}
.empty{margin:12px 0 0;padding:14px 16px;border-radius:8px;background:var(--surface-2);color:var(--ink-2);font-size:13px}

/* charts */
svg.c{display:block;overflow:visible;font-family:var(--sans)}
svg.c text{fill:var(--ink-2);font-size:11.5px}
svg.c .tick{font-size:11px;fill:var(--ink-3)}
svg.c .lbl{fill:var(--ink);font-size:12.5px}
svg.c .lbl2{fill:var(--ink-2);font-size:11.5px}
svg.c .val{fill:var(--ink);font-size:12px;font-weight:600}
svg.c .valsoft{fill:var(--ink-2);font-size:12px}
svg.c .ann{fill:var(--ink-2);font-size:11px}
svg.c .gl{stroke:var(--grid);stroke-width:1}
svg.c .axis{stroke:var(--line);stroke-width:1}
svg.c .band{fill:var(--band)}
svg.c .nodue{fill:var(--surface-2)}
svg.c .bar{fill:var(--mark-soft)}
svg.c .bar.hot{fill:var(--mark)}
svg.c .bar.risk{fill:var(--risk)}
svg.c .line{fill:none;stroke:var(--mark);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
svg.c .line.soft{stroke:var(--ink-3);stroke-width:1.75}
svg.c .line.dash{stroke-dasharray:3 4}
svg.c .line.cum{stroke:var(--accent-ink);stroke-width:2}
svg.c .pt{fill:var(--surface);stroke:var(--mark);stroke-width:2}
svg.c .pt.soft{stroke:var(--ink-3)}
svg.c .pt.cum{stroke:var(--accent-ink)}
svg.c .pt.partial{stroke-dasharray:2 2}
svg.c .ref{stroke:var(--ink-3);stroke-width:1;stroke-dasharray:2 3}
svg.c .hit{fill:transparent;cursor:pointer}
svg.c [data-i]:hover,svg.c [data-i].on{filter:none}
svg.c .on .hl,svg.c .hl.on{stroke:var(--ink);stroke-width:1.5}
svg.c .cal{rx:3;ry:3}
svg.c .k0{fill:var(--c0)}svg.c .k1{fill:var(--c1)}svg.c .k2{fill:var(--c2)}svg.c .k3{fill:var(--c3)}svg.c .k4{fill:var(--c4)}svg.c .k5{fill:var(--c5)}
svg.c .knull{fill:none;stroke:var(--line);stroke-dasharray:2 2}
svg.c .q0{fill:var(--s0)}svg.c .q1{fill:var(--s1)}svg.c .q2{fill:var(--s2)}svg.c .q3{fill:var(--s3)}svg.c .q4{fill:var(--s4)}
svg.c .qnull{fill:none;stroke:var(--ink-3);stroke-width:1;stroke-dasharray:2 2}
svg.c .pr-high{fill:var(--risk);stroke:var(--risk)}
svg.c .pr-medium{fill:var(--warn);stroke:var(--warn)}
svg.c .pr-low{fill:var(--ink-3);stroke:var(--ink-3)}
svg.c .pr-none,svg.c .pr-other{fill:var(--mark-soft);stroke:var(--mark-soft)}
svg.c .ring{fill:var(--surface);stroke-width:2}
svg.c .db-prev{fill:var(--surface);stroke:var(--ink-3);stroke-width:2}
svg.c .db-cur{fill:var(--mark)}
svg.c .db-up{stroke:var(--ok);stroke-width:3;stroke-linecap:round}
svg.c .db-down{stroke:var(--risk);stroke-width:3;stroke-linecap:round}
svg.c .db-flat{stroke:var(--mark-soft);stroke-width:3;stroke-linecap:round}
svg.c .up{fill:var(--ok)}svg.c .down{fill:var(--risk)}
svg.c .faded{opacity:.28}
svg.c .sel-ring{fill:none;stroke:var(--ink);stroke-width:1.5}
svg.c .stk-ok{fill:var(--mark)}svg.c .stk-late{fill:var(--warn)}svg.c .stk-miss{fill:var(--risk)}svg.c .stk-pend{fill:var(--mark-soft)}
svg.c .bracket{stroke:var(--ink);stroke-width:1.5;fill:none}
svg.c .today{fill:none;stroke:var(--ink);stroke-width:1.5}
.sw.k1{background:var(--c1)}.sw.k2{background:var(--c2)}.sw.k3{background:var(--c3)}.sw.k4{background:var(--c4)}.sw.k5{background:var(--c5)}.sw.k0{background:var(--c0)}
.sw.q0{background:var(--s0)}.sw.q1{background:var(--s1)}.sw.q2{background:var(--s2)}.sw.q3{background:var(--s3)}.sw.q4{background:var(--s4)}
.sw.pr-high{background:var(--risk);color:var(--risk)}.sw.pr-medium{background:var(--warn);color:var(--warn)}.sw.pr-low{background:var(--ink-3);color:var(--ink-3)}.sw.pr-none{background:var(--mark-soft);color:var(--mark-soft)}
.sw.mark{background:var(--mark)}.sw.soft{background:var(--mark-soft)}.sw.warn{background:var(--warn)}.sw.risk{background:var(--risk)}.sw.cum{background:var(--accent-ink);height:3px;border-radius:2px;width:14px}
.sw.band{background:var(--band);box-shadow:inset 0 0 0 1px var(--line)}
.sw.hollow{border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 2px var(--ink-3)}
.sw.prev{border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 2px var(--ink-3)}
.sw.cur{border-radius:999px;background:var(--mark)}
.sw.ok-line,.sw.risk-line{width:16px;height:3px;border-radius:2px;background:var(--ok)}.sw.risk-line{background:var(--risk)}
.sw.nodata{background:transparent;box-shadow:inset 0 0 0 1px var(--ink-3);outline:1px dashed var(--line);outline-offset:-1px}
.sw.today{background:transparent;box-shadow:inset 0 0 0 1.5px var(--ink)}
.ramp{display:inline-flex;gap:2px;vertical-align:-1px}

/* tooltip */
.tip{position:fixed;z-index:30;pointer-events:none;max-width:300px;padding:10px 12px;border-radius:10px;background:var(--tip-bg);color:var(--tip-ink);font-size:12.5px;line-height:1.4;box-shadow:0 12px 32px -12px oklch(0 0 0 / 0.5);opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}
.tip.show{opacity:1;transform:none}
.tip .tt{font-weight:650;margin:0 0 2px;overflow-wrap:anywhere}
.tip .ts{font:500 11px var(--mono);color:var(--tip-dim);margin:0 0 6px}
.tip dl{display:grid;grid-template-columns:auto auto;gap:2px 14px;margin:0}
.tip dt{color:var(--tip-dim)}
.tip dd{margin:0;text-align:right;font-weight:600}
.tip .tn{margin:6px 0 0;color:var(--tip-dim);font-size:11.5px}
.tip .better{color:oklch(0.8 0.14 150)}.tip .worse{color:oklch(0.76 0.15 28)}

/* tables */
.tw{margin-top:12px;overflow:auto;max-height:560px;border-radius:8px;box-shadow:inset 0 0 0 1px var(--line)}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
th{position:sticky;top:0;z-index:1;background:var(--surface);text-align:left;font-weight:600;font-size:12px;color:var(--ink-2);border-bottom:1px solid var(--line);padding:0;white-space:nowrap}
th button{display:flex;align-items:center;gap:4px;width:100%;min-height:38px;padding:8px 12px;border:0;background:transparent;cursor:pointer;font:inherit;color:inherit;text-align:inherit}
th.num button{justify-content:flex-end}
th button:hover{color:var(--ink)}
th .ar{font-size:9px;opacity:.35}
th[aria-sort] .ar{opacity:1;color:var(--ink)}
td{padding:9px 12px;border-bottom:1px solid var(--grid);vertical-align:top}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--surface-2)}
tr.row-sel td{background:oklch(0.91 0.2 122 / 0.16);font-weight:600}
td.num,th.num{text-align:right;white-space:nowrap}
td.nw{white-space:nowrap}
td .s{display:block;font-size:12px;color:var(--ink-2)}
td a{color:var(--accent-ink);font-weight:600;text-decoration:none}
td a:hover{text-decoration:underline}
td.better{color:var(--ok);font-weight:600}td.worse{color:var(--risk);font-weight:600}
.pill{display:inline-block;font:600 11px/1 var(--mono);padding:4px 6px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em;background:var(--surface-2);color:var(--ink-2)}
.pill.high{background:var(--risk-soft);color:var(--risk-ink)}.pill.medium{background:var(--warn-soft);color:var(--warn-ink)}

/* notes + footer */
details.notes{margin:4px 0 0;border-top:1px solid var(--line);padding:12px 0 0}
details.notes summary{cursor:pointer;font-size:13px;color:var(--ink-2);min-height:32px;display:flex;align-items:center;gap:8px}
details.notes summary:hover{color:var(--ink)}
details.notes ul{margin:6px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;max-width:110ch}
details.notes li{margin:3px 0}
.foot-data{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);display:grid;gap:14px;color:var(--ink-2);font-size:12.5px}
.foot-data h2{font:650 14px var(--sans);color:var(--ink);margin:0}
.foot-data table{font-size:12.5px;max-width:760px}
.foot-data .tw{max-height:none;width:fit-content;max-width:100%}
.disclaimer{font-size:12px;color:var(--ink-3)}

/* ---------- responsive ---------- */
@media (max-width:1180px){
  .tiles{grid-template-columns:repeat(3,minmax(0,1fr))}
  .tiles.n5{grid-template-columns:repeat(3,minmax(0,1fr))}
  .span-7,.span-5,.span-6,.span-4,.span-8{grid-column:span 12}
}
@media (max-width:900px){
  .app{grid-template-columns:minmax(0,1fr)}
  .nav{position:static;height:auto;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border-right:0;border-bottom:1px solid var(--line);padding:10px 16px 8px;gap:8px 10px}
  .brand{grid-column:1;grid-row:1;padding:0;gap:2px}
  .brand .org{display:none}
  .brand b{font-size:17px}
  .nav ol{grid-column:1 / -1;grid-row:2;display:flex;flex-direction:row;flex-wrap:nowrap;gap:4px;overflow-x:auto;scrollbar-width:none;margin:0 -4px;padding:0 4px}
  .nav ol::-webkit-scrollbar{display:none}
  .nav a.item{flex:0 0 auto;grid-template-columns:auto auto;min-height:44px;padding:8px 12px;font-size:13px;white-space:nowrap}
  .nav a.item .count{display:none}
  .nav .foot{grid-column:2;grid-row:1;flex-direction:row;margin-top:0;padding:0;gap:6px}
  .nav .foot button{width:auto;min-height:44px;padding:6px 12px;font-size:12.5px}
  .nav .foot .k{display:none}
  .nav .fine{display:none}
  .main{padding:0 16px 48px}
  .bar{position:static}
  .chips{margin-left:0}
}
@media (max-width:560px){
  .att a,td a{display:inline-flex;align-items:center;min-height:44px;min-width:44px}
  .tiles,.tiles.n4,.tiles.n5{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .tile{padding:12px 12px 10px}
  .tile .v{font-size:24px}
  h1{font-size:25px}
  .answer{font-size:17px}
  .card{padding:16px 14px 14px}
  .sel{width:100%}.sel select{flex:1;max-width:none}
  .seg{width:100%}.seg button{flex:1;min-width:0}
}
@media (prefers-reduced-motion:reduce){
  .view{animation:none}
  .tip{transition:none}
  *{scroll-behavior:auto!important}
}

/* ---------- print ---------- */
@page{size:A4 landscape;margin:12mm}
@media print{
  :root,:root[data-theme="dark"]{--bg:#fff;--surface:#fff;--surface-2:oklch(0.97 0.003 250);--shadow:0 0 0 1px oklch(0.9 0.006 250);color-scheme:light}
  body{font-size:12px}
  .app{display:block}
  .nav,.bar .seg,.bar .sel,.chip button,.skip,.tip,details.notes summary .hint{display:none!important}
  .bar{position:static;border:0;padding:0 0 8px}
  .chips{margin-left:0}
  .main{padding:0}
  .view{animation:none;padding-top:8px;break-before:page}
  .view:first-of-type{break-before:auto}
  .card,.tile,tr{break-inside:avoid}
  .tw{max-height:none;overflow:visible}
  th{position:static}
  details.notes{display:block}
  a{text-decoration:none}
}
`;
