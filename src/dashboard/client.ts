/**
 * Browser code for the dashboard, embedded inline in the HTML file (no external scripts). Two halves:
 *
 * - `R` (pure): turns the precomputed data plus the current filters into HTML/SVG strings. It never touches
 *   the DOM, so the tests run it in a Node vm sandbox. It formats, filters, sorts and lays out; it never
 *   computes a metric: every number it prints is read from the embedded data.
 * - the DOM layer: hash routing, filters, sortable tables, tooltips, keyboard, theme, resize, print, and the
 *   MCP Apps handshake when the page is hosted inline by an MCP client.
 *
 * Every string from the data is escaped with esc() before it reaches innerHTML (record text is untrusted),
 * and links are only emitted when they match the Mitti web app origin.
 *
 * Written as a plain string (String.raw): no template literals or "${" inside, so TypeScript never
 * interpolates into it. The tests parse it to catch syntax errors.
 */
export const CLIENT_JS = String.raw`
var R = (function () {
  'use strict';
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var SAFE = /^https:\/\/app\.safetyculture\.com\/[A-Za-z0-9\/_\-.?=&%]*$/;
  var PRIORITIES = ['high','medium','low','none'];
  var PR_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: 'No priority', other: 'Other' };

  // ---------------------------------------------------------------- formatting (display only)
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function grp(n) { var p = String(Math.abs(n)).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n < 0 ? '−' : '') + p.join('.'); }
  function fmt(v, unit) { return v === null || v === undefined || !isFinite(v) ? 'n/a' : grp(v) + (unit || ''); }
  function signed(v, unit) { if (v === null || v === undefined || !isFinite(v)) return 'n/a'; return (v > 0 ? '+' : v < 0 ? '−' : '±') + grp(Math.abs(v)) + (unit || ''); }
  function dpOf(vals) { var d = 0; vals.forEach(function (v) { if (v !== null && v !== undefined && isFinite(v)) { var m = String(v).split('.')[1]; if (m) d = Math.max(d, Math.min(2, m.length)); } }); return d; }
  /** Fixed decimals so a column or chart reads evenly (10.16, 9.20, 4.70); formatting only, values unchanged. */
  function fmtD(v, dp, unit) { if (v === null || v === undefined || !isFinite(v)) return 'n/a'; var a = Math.abs(Number(v)).toFixed(dp), p = a.split('.'); return (Number(v) < 0 && Number(a) !== 0 ? '\u2212' : '') + grp(Number(p[0])) + (p[1] ? '.' + p[1] : '') + (unit || ''); }
  function signedD(v, dp, unit) { if (v === null || v === undefined || !isFinite(v)) return 'n/a'; return (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtD(Math.abs(v), dp) + (unit || ''); }
  /** Failed-item rates read at 2 dp on every surface, matching the safety pulse. */
  function rate(v) { return fmtD(v, 2, '%'); }
  function rateCol(k, label) { return n(k, label, '%', { h: function (r) { return esc(rate(r[k])); } }); }
  function trendText(sr) { return sr.direction ? '. Fitted trend: ' + sr.direction + (sr.recent ? '; ' + sr.recent : '') + '.' : ''; }
  function pp(unit) { return unit === '%' ? ' pts' : ''; }
  function href(h) { return h && SAFE.test(h) ? h : null; }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function dayLabel(iso) { var x = ymd(iso); return x.d + ' ' + MON[x.m] + ' ' + x.y; }
  function shortDay(iso) { var x = ymd(iso); return x.d + ' ' + MON[x.m]; }
  function monthLabel(iso) { var x = ymd(iso); return MON[x.m] + ' ' + x.y; }
  function addDays(iso, n) { var x = ymd(iso); return new Date(Date.UTC(x.y, x.m, x.d) + n * 864e5).toISOString().slice(0, 10); }
  function dowOf(iso) { var x = ymd(iso); return (new Date(Date.UTC(x.y, x.m, x.d)).getUTCDay() + 6) % 7; }
  /** "last 90 days (2026-07-11 to 2026-10-08)" -> "11 Jul to 8 Oct 2026" */
  function rangeOf(label) {
    var m = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(String(label));
    if (!m) return String(label);
    var a = ymd(m[1]), b = ymd(m[2]);
    return a.d + ' ' + MON[a.m] + (a.y !== b.y ? ' ' + a.y : '') + ' to ' + b.d + ' ' + MON[b.m] + ' ' + b.y;
  }
  function tipAttr(t) { return ' data-tip="' + esc(JSON.stringify(t)) + '"'; }
  function judge(delta, good) { if (delta === null || delta === undefined || delta === 0 || !good) return ''; return (delta > 0) === (good === 'up') ? 'better' : 'worse'; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

  // ---------------------------------------------------------------- scales and measuring
  function lin(d0, d1, r0, r1) { var k = (r1 - r0) / ((d1 - d0) || 1); return function (v) { return r0 + (v - d0) * k; }; }
  function niceStep(raw) { if (!(raw > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)); var c = [1, 2, 2.5, 5, 10]; for (var i = 0; i < c.length; i++) if (c[i] * p >= raw) return c[i] * p; return 10 * p; }
  function domain(lo, hi, n, zero) {
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
    if (zero) lo = Math.min(0, lo);
    if (!(hi > lo)) hi = lo + 1;
    var step = niceStep((hi - lo) / (n || 4));
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    if (b === a) b = a + step;
    var ticks = []; for (var v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo: a, hi: b, ticks: ticks };
  }
  function mw(env, text, size, weight) { return env.measure(String(text), size || 11.5, weight || 400); }
  function clip(env, text, size, max, weight) {
    text = String(text);
    if (mw(env, text, size, weight) <= max) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (mw(env, text.slice(0, mid) + '…', size, weight) <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, Math.max(1, lo)).replace(/\s+$/, '') + '…';
  }
  function svg(w, h, body, label) { return '<svg class="c" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + body + '</svg>'; }
  function t(x, y, s, cls, anchor, extra) { return '<text x="' + r1(x) + '" y="' + r1(y) + '"' + (cls ? ' class="' + cls + '"' : '') + (anchor ? ' text-anchor="' + anchor + '"' : '') + (extra || '') + '>' + esc(s) + '</text>'; }
  function r1(v) { return Math.round(v * 10) / 10; }

  // ---------------------------------------------------------------- shared pieces
  function unavailable(reason, what) {
    return '<div class="unavail" role="note"><b>Unavailable</b><span>' + esc(what ? what + ': ' : '') + esc(reason) + '</span></div>';
  }
  function card(span, title, sub, body, foot) {
    return '<section class="card span-' + span + '"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + body + (foot ? '<p class="foot">' + foot + '</p>' : '') + '</section>';
  }
  function chartSlot(id, label, minH) { return '<div class="chart" data-chart="' + id + '" tabindex="0" role="group" aria-label="' + esc(label + '. Use arrow keys to step through the values.') + '" style="min-height:' + (minH || 60) + 'px"></div>'; }
  function legend(items) { return '<ul class="legend">' + items.map(function (i) { return '<li><span class="sw ' + i[0] + '" aria-hidden="true"></span>' + esc(i[1]) + '</li>'; }).join('') + '</ul>'; }
  function notes(items, extra) {
    var list = (items || []).concat(extra || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!list.length) return '';
    return '<details class="notes"><summary>About these figures (' + list.length + ' note' + (list.length === 1 ? '' : 's') + ')</summary><ul>' + list.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></details>';
  }
  function head(ctx, eyebrow, title, question, answer) {
    return '<header class="head"><span class="eyebrow">' + esc(eyebrow) + '</span><h1 id="view-title">' + esc(title) + '</h1><p class="question">' + esc(question) + '</p>' + (answer ? '<p class="answer">' + answer + '</p>' : '') + '</header>';
  }
  /** The headline sentence with its first figure marked (the one highlighter per screen). */
  function markFirst(s, plain) {
    var m = plain ? null : /[+\u2212-]?\d[\d,.]*(%| points| pts)?/.exec(String(s));
    if (!m) return esc(s);
    return esc(s.slice(0, m.index)) + '<mark>' + esc(m[0].replace(/[.,]$/, '')) + '</mark>' + esc(m[0].match(/[.,]$/) ? m[0].slice(-1) : '') + esc(s.slice(m.index + m[0].length));
  }
  function calLegend() {
    return '<ul class="legend"><li><span class="sw k0" aria-hidden="true"></span>None</li><li>Fewer <span class="ramp" aria-hidden="true"><span class="sw k1"></span><span class="sw k2"></span><span class="sw k3"></span><span class="sw k4"></span><span class="sw k5"></span></span> More</li><li><span class="sw nodata" aria-hidden="true"></span>No records yet</li><li><span class="sw today" aria-hidden="true"></span>Today (in progress)</li></ul>';
  }

  function tile(tl, ctx, spark) {
    var unit = tl.unit || '';
    var v = tl.unavailable ? '<div class="v na">Unavailable</div>' : '<div class="v">' + esc(fmt(tl.value)) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>';
    var cls = judge(tl.delta, tl.good);
    var d;
    if (tl.unavailable) d = '<div class="d">' + esc(tl.unavailable) + '</div>';
    else if (tl.delta !== null && tl.delta !== undefined) d = '<div class="d ' + cls + '"><span class="ar" aria-hidden="true">' + (tl.delta > 0 ? '▲' : tl.delta < 0 ? '▼' : '●') + '</span>' + esc(signed(tl.delta, pp(unit) || '')) + ' vs previous' + (cls ? '<span class="sr"> (' + cls + ')</span>' : '') + '</div>';
    else d = '<div class="d">' + esc(tl.note || '') + '</div>';
    if (tl.sub) d += '<div class="d">' + esc(tl.sub) + '</div>';
    var rows = [];
    if (tl.unavailable) rows.push(['Status', 'unavailable']);
    else {
      rows.push(['This period', fmt(tl.value, unit)]);
      if (tl.previous !== null && tl.previous !== undefined) rows.push(['Previous period', fmt(tl.previous, unit)]);
      if (tl.delta !== null && tl.delta !== undefined) rows.push(['Change', signed(tl.delta, pp(unit)), cls]);
      if (tl.n_current !== undefined && unit) rows.push(['Observations', fmt(tl.n_current) + ' vs ' + fmt(tl.n_previous)]);
    }
    var tip = { t: tl.label, s: ctx.period.long + ' · ' + rangeOf(ctx.period.label), r: rows, n: tl.unavailable || tl.note || (tl.delta !== null && tl.delta !== undefined ? 'Compared with ' + rangeOf(ctx.period.previous_label) + '.' : '') };
    return '<div class="tile" tabindex="0"' + tipAttr(tip) + '><div class="l">' + esc(tl.label) + '</div>' + v + d + (spark ? '<div class="spark" data-chart="' + spark + '" aria-hidden="true"></div>' : '') + '</div>';
  }

  // ---------------------------------------------------------------- charts

  /** Sparkline: shape only, partial buckets hollow. Same series as the trend charts. */
  function sparkline(pts, w) {
    var h = 28, vals = pts.filter(function (p) { return p.value !== null; });
    if (vals.length < 2) return '';
    var lo = Math.min.apply(null, vals.map(function (p) { return p.value; })), hi = Math.max.apply(null, vals.map(function (p) { return p.value; }));
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }
    var x = lin(0, pts.length - 1, 3, w - 4), y = lin(lo, hi, h - 3, 3), dpath = '', pen = false, body = '';
    pts.forEach(function (p, i) { if (p.value === null) { pen = false; return; } dpath += (pen ? 'L' : 'M') + r1(x(i)) + ' ' + r1(y(p.value)) + ' '; pen = true; });
    body += '<path class="line soft" d="' + dpath + '"/>';
    var last = pts.length - 1; while (last > 0 && pts[last].value === null) last--;
    var lp = pts[last];
    body += '<circle class="pt' + (lp.partial ? ' partial soft' : '') + '" cx="' + r1(x(last)) + '" cy="' + r1(y(lp.value)) + '" r="2.5"/>';
    return svg(w, h, body, 'trend');
  }

  /**
   * Line chart for weekly/monthly trend series with partial-period markers (hollow, dashed approach) and the
   * selected period as a band. Margins come from measured tick and end-label widths.
   */
  function lineChart(env, o, w) {
    var vf = function (v, u) { return o.dp !== undefined ? fmtD(v, o.dp, u) : fmt(v, u); };
    var series = o.series.filter(function (s) { return s.points.length; });
    if (!series.length) return '';
    var n = series[0].points.length, unit = o.unit || '';
    var all = []; series.forEach(function (s) { s.points.forEach(function (p) { if (p.value !== null) all.push(p.value); }); });
    if (!all.length) return '<p class="empty">No values in this window.</p>';
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var dm = o.zero ? domain(0, hi, 4, true) : domain(lo - (hi - lo) * 0.15, hi + (hi - lo) * 0.15, 4, false);
    if (unit === '%') { dm.lo = Math.max(0, dm.lo); dm.hi = Math.min(100, dm.hi); dm.ticks = dm.ticks.filter(function (v) { return v >= dm.lo && v <= dm.hi; }); }
    var tw = Math.max.apply(null, dm.ticks.map(function (v) { return mw(env, fmt(v, unit), 11); }));
    var endW = Math.max.apply(null, series.map(function (s) { var lp = lastPoint(s.points); return mw(env, (s.name ? s.name + ' ' : '') + vf(lp ? lp.value : null, unit), 12, 600); }));
    var narrow = w < 480;
    var M = { l: Math.ceil(tw) + 10, r: narrow ? 8 : Math.ceil(endW) + 14, t: narrow ? 30 : 12, b: 26 };
    var h = o.height || Math.round(Math.max(170, Math.min(250, (w - M.l - M.r) * 0.42)));
    var pw = w - M.l - M.r, ph = h - M.t - M.b;
    var step = pw / Math.max(1, n), x = function (i) { return M.l + step * (i + 0.5); }, y = lin(dm.lo, dm.hi, M.t + ph, M.t);
    var body = '';
    // selected-period band (skipped when it covers the whole window)
    if (o.band) {
      var inBand = series[0].points.map(function (p, i) { var end = i + 1 < n ? series[0].points[i + 1].from : o.windowTo; return p.from < o.band.to && end > o.band.from; });
      var first = inBand.indexOf(true), lastB = inBand.lastIndexOf(true);
      if (first >= 0 && !(first === 0 && lastB === n - 1)) {
        body += '<rect class="band" x="' + r1(M.l + step * first) + '" y="' + M.t + '" width="' + r1(step * (lastB - first + 1)) + '" height="' + ph + '"/>';
        body += t(M.l + step * first + 6, M.t + 12, 'Selected period', 'ann');
      }
    }
    dm.ticks.forEach(function (v) { body += '<line class="gl" x1="' + M.l + '" x2="' + (w - M.r) + '" y1="' + r1(y(v)) + '" y2="' + r1(y(v)) + '"/>' + t(M.l - 8, y(v) + 4, fmt(v, unit), 'tick', 'end'); });
    // x ticks thinned by measured label width
    var labs = series[0].points.map(function (p) { return o.grain === 'month' ? MON[ymd(p.bucket + '-01').m] : shortDay(p.bucket); });
    var lw = Math.max.apply(null, labs.map(function (l) { return mw(env, l, 11); })) + 10;
    var every = Math.max(1, Math.ceil(lw / step));
    labs.forEach(function (l, i) {
      if ((n - 1 - i) % every !== 0) return;
      var half = mw(env, l, 11) / 2, xi = x(i);
      body += xi + half > w ? t(w, h - 8, l, 'tick', 'end') : xi - half < 0 ? t(0, h - 8, l, 'tick', 'start') : t(xi, h - 8, l, 'tick', 'middle');
    });
    series.forEach(function (s, si) {
      var d = '', dd = '', pen = false, prev = null;
      s.points.forEach(function (p, i) {
        if (p.value === null) { pen = false; prev = null; return; }
        var seg = r1(x(i)) + ' ' + r1(y(p.value));
        var dashed = p.partial || (prev && prev.partial);
        if (!pen) { d += 'M' + seg + ' '; }
        else if (dashed) { dd += 'M' + r1(x(i - 1)) + ' ' + r1(y(prev.value)) + ' L' + seg + ' '; d += 'M' + seg + ' '; }
        else d += 'L' + seg + ' ';
        pen = true; prev = p;
      });
      var cls = s.cls || '';
      body += '<path class="line ' + cls + '" d="' + d + '"/>' + (dd ? '<path class="line dash ' + cls + '" d="' + dd + '"/>' : '');
      s.points.forEach(function (p, i) { if (p.value !== null && (p.partial || n <= 26)) body += '<circle class="pt ' + cls + (p.partial ? ' partial' : '') + '" cx="' + r1(x(i)) + '" cy="' + r1(y(p.value)) + '" r="' + (p.partial ? 3.5 : 2.75) + '"/>'; });
      var li = lastIndex(s.points);
      if (li >= 0) {
        var lp = s.points[li], lx = x(li) + 8, ly = y(lp.value) + 4;
        if (narrow) body += t(M.l + si * (pw / 2), 14, (s.name ? s.name : 'Latest') + ' ' + vf(lp.value, unit), 'val', 'start');
        else body += t(lx, ly + (series.length > 1 ? endOffset(series, si, li, y) : 0), (s.name ? s.name + ' ' : '') + vf(lp.value, unit), 'val');
      }
    });
    // hit columns
    for (var i = 0; i < n; i++) {
      var rows = [], first2 = series[0].points[i];
      series.forEach(function (s) { var p = s.points[i]; rows.push([s.name || o.name, p.value === null ? 'n/a' : vf(p.value, unit)]); if (p.change !== null && p.change !== undefined && series.length === 1) rows.push(['vs previous ' + o.grain, signed(p.change, pp(unit)), judge(p.change, o.good)]); });
      if (series.length === 1 && first2.n !== undefined && unit) rows.push(['Observations', fmt(first2.n)]);
      var lbl = (o.grain === 'month' ? monthLabel(first2.bucket + '-01') : 'Week of ' + dayLabel(first2.bucket));
      var tip = { t: lbl, s: o.title, r: rows, n: first2.partial ? 'Partial ' + o.grain + ': covers fewer days, so a count reads lower for that reason alone.' : '' };
      body += '<rect class="hit" data-i="' + i + '"' + tipAttr(tip) + ' x="' + r1(M.l + step * i) + '" y="' + M.t + '" width="' + r1(step) + '" height="' + ph + '"/>';
    }
    body = '<line class="axis" x1="' + M.l + '" x2="' + (w - M.r) + '" y1="' + r1(M.t + ph) + '" y2="' + r1(M.t + ph) + '"/>' + body;
    return svg(w, h, body, o.title);
  }
  function lastIndex(pts) { for (var i = pts.length - 1; i >= 0; i--) if (pts[i].value !== null) return i; return -1; }
  function lastPoint(pts) { var i = lastIndex(pts); return i >= 0 ? pts[i] : null; }
  function endOffset(series, si, li, y) {
    if (series.length < 2) return 0;
    var a = series[0].points[lastIndex(series[0].points)], b = series[1].points[lastIndex(series[1].points)];
    if (!a || !b) return 0;
    var gap = Math.abs(y(a.value) - y(b.value));
    if (gap >= 16) return 0;
    var up = (si === 0) === (y(a.value) <= y(b.value));
    return up ? -(16 - gap) / 2 - 1 : (16 - gap) / 2 + 1;
  }

  /** Sorted horizontal bars: >= 30px per row; labels truncated to a measured width with the full text in the tooltip. */
  function hbars(env, o, w) {
    var rows = o.rows; if (!rows.length) return '';
    var narrow = w < 360, unit = o.unit || '';
    var vw = Math.max.apply(null, rows.map(function (r) { return mw(env, r.valueText || fmt(r.value, unit), 12, 600); }));
    var labelW = narrow ? 0 : Math.min(Math.ceil(Math.max.apply(null, rows.map(function (r) { return mw(env, r.label, 12.5); }))) + 12, Math.round(w * 0.38));
    var rowH = narrow ? 46 : 32, top = 4, h = top + rows.length * rowH + 6;
    var x0 = labelW, x1 = w - Math.ceil(vw) - 10;
    var max = o.max || Math.max.apply(null, rows.map(function (r) { return r.value || 0; })) || 1;
    var x = lin(0, max, x0, x1), body = '';
    rows.forEach(function (r, i) {
      var y0 = top + i * rowH, bh = 14, by = narrow ? y0 + 22 : y0 + (rowH - bh) / 2;
      var label = clip(env, r.label, 12.5, narrow ? w - 8 : labelW - 12);
      body += '<g data-i="' + i + '"' + tipAttr(r.tip) + (r.faded ? ' class="faded"' : '') + '>';
      body += '<rect class="hit" x="0" y="' + y0 + '" width="' + w + '" height="' + rowH + '"/>';
      body += t(1, narrow ? y0 + 14 : by + 11, label, 'lbl');
      var bw = r.value === null ? 0 : Math.max(2, x(r.value) - x0);
      body += '<rect class="bar ' + (r.cls || '') + '" x="' + x0 + '" y="' + r1(by) + '" width="' + r1(bw) + '" height="' + bh + '" rx="2"/>';
      body += t(x0 + bw + 6, by + 11, r.valueText || fmt(r.value, unit), r.cls === 'hot' || r.cls === 'risk' ? 'val' : 'valsoft');
      if (r.sel) body += '<rect class="sel-ring" x="' + (x0 - 3) + '" y="' + r1(by - 3) + '" width="' + r1(bw + 6) + '" height="' + (bh + 6) + '" rx="4"/>';
      body += '</g>';
    });
    return svg(w, h, body, o.title);
  }

  /**
   * Failed-item Pareto, horizontal: bars = failed answers per question (largest first), and a separate
   * cumulative-share panel on the right whose line runs down the rows to 100%. Two panels with their own
   * axes instead of a shared dual axis.
   */
  function pareto(env, ins, w) {
    var rows = ins.rows, narrow = w < 560;
    var cumW = narrow ? 104 : Math.min(240, Math.round(w * 0.22));
    var vw = Math.max.apply(null, rows.map(function (r) { return mw(env, fmt(r.failed), 12, 600); })) + 8;
    var labelW = narrow ? 0 : Math.min(Math.round(w * 0.36), Math.ceil(Math.max.apply(null, rows.map(function (r) { return Math.max(mw(env, r.label, 12.5), mw(env, r.template, 11.5)); }))) + 14);
    var rowH = narrow ? 50 : 36, top = 46, h = top + rows.length * rowH + 8;
    var x0 = labelW, cx0 = w - cumW, cx1 = w - 34, x1 = cx0 - vw - 18;
    var max = Math.max.apply(null, rows.map(function (r) { return r.failed; })) || 1;
    var x = lin(0, max, x0, x1), cxs = lin(0, 100, cx0, cx1);
    var body = '';
    body += t(x0, 12, 'Failed answers', 'ann') + t(cx0, 12, narrow ? 'Cumulative' : 'Cumulative share', 'ann');
    [0, 50, 100].forEach(function (v) { body += '<line class="' + (v === 50 ? 'ref' : 'gl') + '" x1="' + r1(cxs(v)) + '" x2="' + r1(cxs(v)) + '" y1="' + (top - 6) + '" y2="' + (h - 6) + '"/>' + (narrow && v === 50 ? '' : t(cxs(v), top - 12, v + '%', 'tick', v === 0 ? 'start' : v === 100 ? 'end' : 'middle')); });
    var path = '';
    rows.forEach(function (r, i) {
      var y0 = top + i * rowH, bh = 14, by = narrow ? y0 + 26 : y0 + (rowH - bh) / 2;
      var vital = ins.vital !== null && r.rank <= ins.vital;
      var tip = { t: r.label, s: r.template + ' · rank ' + r.rank + ' of ' + fmt(ins.groups) + ' failing questions', r: [['Failed answers', fmt(r.failed)], ['Share of all failed', fmt(r.share, '%')], ['Cumulative share', fmt(r.cumulative, '%')], ['Failure rate', rate(r.rate) + ' of ' + fmt(r.answered)]].concat(r.change === null ? [] : [['vs previous period', signed(r.change) + ' (' + fmt(r.previous) + ' before)', judge(r.change, 'down')]]), n: r.href ? 'Click to open the latest example in Mitti.' : '' };
      body += '<g data-i="' + i + '"' + tipAttr(tip) + (r.href ? ' data-href="' + esc(r.href) + '"' : '') + '><rect class="hit" x="0" y="' + y0 + '" width="' + w + '" height="' + rowH + '"/>';
      if (narrow) body += t(1, y0 + 13, clip(env, r.rank + '. ' + r.label, 12.5, w - 8), 'lbl') + '<title>' + esc(r.label) + '</title>';
      else body += t(1, y0 + 15, clip(env, r.label, 12.5, labelW - 14), 'lbl') + t(1, y0 + 29, clip(env, r.template, 11.5, labelW - 14), 'lbl2');
      var bw = Math.max(2, x(r.failed) - x0);
      body += '<rect class="bar' + (vital ? ' hot' : '') + '" x="' + x0 + '" y="' + r1(by) + '" width="' + r1(bw) + '" height="' + bh + '" rx="2"/>' + t(x0 + bw + 6, by + 11, fmt(r.failed), vital ? 'val' : 'valsoft');
      var cy = by + bh / 2;
      path += (i ? 'L' : 'M') + r1(cxs(r.cumulative || 0)) + ' ' + r1(cy) + ' ';
      body += '</g>';
      r._cy = cy;
    });
    body += '<path class="line cum" d="' + path + '"/>';
    rows.forEach(function (r) { body += '<circle class="pt cum" cx="' + r1(cxs(r.cumulative || 0)) + '" cy="' + r1(r._cy) + '" r="3"/>'; });
    var lr = rows[rows.length - 1];
    if (lr) body += t(cxs(lr.cumulative || 0) + 8, lr._cy + 4, fmt(lr.cumulative, '%'), 'val');
    if (ins.vital) { var vr = rows[ins.vital - 1]; body += t(Math.min(cxs(vr.cumulative) + 8, cx1 - 2), vr._cy + 4, fmt(vr.cumulative, '%'), 'val'); }
    return svg(w, h, body, 'Failed-item Pareto');
  }

  function calStep(v, max) { if (v === null) return 'knull'; if (v === 0) return 'k0'; var q = v / max; return q <= 0.2 ? 'k1' : q <= 0.4 ? 'k2' : q <= 0.6 ? 'k3' : q <= 0.8 ? 'k4' : 'k5'; }
  /**
   * Calendar heatmap, one cell per day. Wide: GitHub-style strip (weeks as columns, Monday first). When a
   * 53-week strip cannot keep cells >= 14px, it facets into month grids (small multiples) instead of shrinking.
   */
  function calendarChart(env, cal, ctx, w) {
    if (!cal.values || !cal.values.length) return '';
    var vals = cal.values, start = cal.start, max = Math.max.apply(null, vals.map(function (v) { return v || 0; })) || 1;
    var off = dowOf(start), weeks = Math.ceil((vals.length + off) / 7);
    var lw = Math.ceil(mw(env, 'Wed', 11)) + 10;
    var cell = Math.floor((w - lw) / weeks);
    var band = ctx.period, body = '', gap = 3;
    function tipFor(i) {
      var d = addDays(start, i), v = vals[i];
      if (v === null) return { t: dayLabel(d), s: DOW[dowOf(d)], r: [], n: 'Before the first cached inspection: no records yet (not zero).' };
      var r = [['Inspections completed', fmt(v)]];
      if (cal.delta_week[i] !== null) r.push(['vs ' + DOW[dowOf(d)] + ' a week earlier', signed(cal.delta_week[i])]);
      r.push(['Rank in ' + MON[ymd(d).m], '#' + cal.month_rank[i]]);
      return { t: dayLabel(d), s: DOW[dowOf(d)] + (i === vals.length - 1 ? ' · today, still in progress' : ''), r: r, n: '' };
    }
    var inSel = function (d) { return d + 'T00:00:00.000Z' >= band.from && d + 'T00:00:00.000Z' < band.to; };
    if (cell >= 14) {
      cell = Math.min(cell, 22);
      var top = 50, h = top + 7 * cell + 4;
      var x0 = lw;
      // month labels
      var lastM = -1;
      for (var i = 0; i < vals.length; i++) {
        var d = addDays(start, i), m = ymd(d).m, col = Math.floor((i + off) / 7);
        if (m !== lastM && ymd(d).d <= 7) { body += t(x0 + col * cell, 12, MON[m] + (m === 0 ? ' ' + ymd(d).y : ''), 'tick'); lastM = m; }
      }
      [0, 2, 4].forEach(function (r) { body += t(lw - 8, top + r * cell + cell * 0.7, DOW[r], 'tick', 'end'); });
      // selected-period bracket
      var si = -1, ei = -1;
      for (var k = 0; k < vals.length; k++) if (inSel(addDays(start, k))) { if (si < 0) si = k; ei = k; }
      if (si >= 0 && !(si === 0 && ei === vals.length - 1)) {
        var c0 = Math.floor((si + off) / 7), c1 = Math.floor((ei + off) / 7);
        var bx0 = x0 + c0 * cell, bx1 = x0 + (c1 + 1) * cell - gap;
        body += '<path class="bracket" d="M' + bx0 + ' ' + (top - 6) + 'V' + (top - 11) + 'H' + bx1 + 'V' + (top - 6) + '"/>';
        var cap = 'Selected: ' + ctx.period.long.toLowerCase();
        var cw = mw(env, cap, 11);
        body += t(Math.max(x0, Math.min(bx1 - cw, (bx0 + bx1) / 2 - cw / 2)), top - 17, cap, 'ann');
      }
      for (var j = 0; j < vals.length; j++) {
        var c = Math.floor((j + off) / 7), r = (j + off) % 7, xx = x0 + c * cell, yy = top + r * cell;
        body += '<rect class="cal ' + calStep(vals[j], max) + (j === vals.length - 1 ? ' hl' : '') + '" data-i="' + j + '"' + tipAttr(tipFor(j)) + ' x="' + xx + '" y="' + yy + '" width="' + (cell - gap) + '" height="' + (cell - gap) + '"/>';
      }
      var tj = vals.length - 1;
      body += '<rect class="today" x="' + (x0 + Math.floor((tj + off) / 7) * cell - 1) + '" y="' + (top + ((tj + off) % 7) * cell - 1) + '" width="' + (cell - gap + 2) + '" height="' + (cell - gap + 2) + '" rx="3"/>';
      return svg(w, h, body, 'Inspections completed per day, last 12 months');
    }
    // small multiples: one month grid per calendar month
    var months = []; var cur = null, inSelPartly = !(band.from <= start + 'T00:00:00.000Z' && band.to > addDays(start, vals.length - 1) + 'T00:00:00.000Z');
    for (var q = 0; q < vals.length; q++) { var dq = addDays(start, q), key = dq.slice(0, 7); if (!cur || cur.key !== key) { cur = { key: key, first: q, days: [] }; months.push(cur); } cur.days.push(q); }
    var per = w >= 330 ? 3 : 2, gutter = 12, mwid = Math.floor((w - gutter * (per - 1)) / per), mc = Math.floor(mwid / 7);
    if (mc > 22) mc = 22;
    var mh = 18 + 6 * mc + 8, rowsN = Math.ceil(months.length / per), hh = rowsN * mh;
    months.forEach(function (mo, idx) {
      var gx = (idx % per) * (mwid + gutter), gy = Math.floor(idx / per) * mh;
      body += t(gx + 1, gy + 12, monthLabel(mo.key + '-01'), 'tick');
      var firstDow = dowOf(addDays(start, mo.first)), firstDay = ymd(addDays(start, mo.first)).d;
      mo.days.forEach(function (i) {
        var d = addDays(start, i), pos = firstDow + (ymd(d).d - firstDay), r = Math.floor(pos / 7), c = pos % 7;
        body += '<rect class="cal ' + calStep(vals[i], max) + '" data-i="' + i + '"' + tipAttr(tipFor(i)) + ' x="' + (gx + c * mc) + '" y="' + (gy + 18 + r * mc) + '" width="' + (mc - 2) + '" height="' + (mc - 2) + '"/>';
        if (inSel(d) && inSelPartly) body += '<rect class="today" x="' + (gx + c * mc - 1) + '" y="' + (gy + 18 + r * mc - 1) + '" width="' + mc + '" height="' + mc + '" rx="3" style="stroke-width:1;opacity:.55"/>';
      });
    });
    return svg(w, hh, body, 'Inspections completed per day, last 12 months, by month');
  }

  function stripeStep(p) { return p === null ? 'qnull' : p >= 95 ? 'q0' : p >= 85 ? 'q1' : p >= 70 ? 'q2' : p >= 50 ? 'q3' : 'q4'; }
  /** Compliance stripes: one stripe per week coloured by on-time share (low share = saturated), plus due volume below. */
  function stripesChart(env, st, ctx, w) {
    if (!st.weeks || !st.weeks.length) return '';
    var weeks = st.weeks, n = weeks.length, top = 28, sh = 92, vh = 30, gapM = 24, h = top + sh + gapM + vh + 22;
    var sw = w / n, body = '';
    var maxDue = Math.max.apply(null, weeks.map(function (x) { return x.due; })) || 1, vy = lin(0, maxDue, top + sh + gapM + vh, top + sh + gapM);
    var si = -1, ei = -1;
    weeks.forEach(function (wk, i) { var a = wk.from + 'T00:00:00.000Z', b = addDays(wk.to, 1) + 'T00:00:00.000Z'; if (a < ctx.period.to && b > ctx.period.from) { if (si < 0) si = i; ei = i; } });
    if (si >= 0 && !(si === 0 && ei === n - 1)) {
      body += '<path class="bracket" d="M' + r1(si * sw) + ' ' + (top - 4) + 'V' + (top - 8) + 'H' + r1((ei + 1) * sw - 1) + 'V' + (top - 4) + '"/>';
      var cap = 'Selected: ' + ctx.period.long.toLowerCase(), cw = mw(env, cap, 11);
      body += t(Math.max(0, Math.min(w - cw, ((si + ei + 1) * sw) / 2 - cw / 2)), top - 12, cap, 'ann');
    }
    weeks.forEach(function (wk, i) {
      var p = wk.compliance_pct, x = i * sw;
      var rows = p === null ? [['Due', fmt(wk.due)], ['Resolved', fmt(wk.resolved)]] : [['On time', fmt(p, '%')], ['On time / late / missed', fmt(wk.on_time) + ' / ' + fmt(wk.late) + ' / ' + fmt(wk.missed)], ['Due', fmt(wk.due)]];
      if (wk.change_pp !== null) rows.push(['vs previous week', signed(wk.change_pp, ' pts'), judge(wk.change_pp, 'up')]);
      if (wk.rank_low !== null) rows.push(['Rank', wk.rank_low === 1 ? 'lowest of ' + wk.rated_weeks + ' weeks' : '#' + wk.rank_low + ' lowest of ' + wk.rated_weeks]);
      var tip = { t: 'Week of ' + dayLabel(wk.week), s: dayLabel(wk.from) + ' to ' + dayLabel(wk.to) + (wk.partial ? ' (partial week)' : ''), r: rows, n: p === null ? (wk.due ? 'Nothing resolved yet this week, so no on-time share.' : 'Nothing was due this week.') : '' };
      body += '<g data-i="' + i + '"' + tipAttr(tip) + '><rect class="hit" x="' + r1(x) + '" y="0" width="' + r1(sw) + '" height="' + h + '"/>';
      body += '<rect class="' + stripeStep(p) + '" x="' + r1(x + (p === null ? 1 : 0)) + '" y="' + (top + (p === null ? 1 : 0)) + '" width="' + r1(Math.max(1, sw - (p === null ? 2 : 0.6))) + '" height="' + (sh - (p === null ? 2 : 0)) + '"/>';
      if (wk.due) body += '<rect class="bar" x="' + r1(x + sw * 0.18) + '" y="' + r1(vy(wk.due)) + '" width="' + r1(Math.max(1, sw * 0.64)) + '" height="' + r1(top + sh + gapM + vh - vy(wk.due)) + '"/>';
      body += '</g>';
    });
    body += t(1, top + sh + gapM + vh + 16, 'Bars: occurrences due per week (tallest ' + fmt(maxDue) + ')', 'ann');
    var lastM = -1, lastX = -99;
    weeks.forEach(function (wk, i) { var m = ymd(wk.week).m; if (m !== lastM) { lastM = m; var lx = i * sw; if (lx - lastX > mw(env, 'Mmm', 11) + 10 && i > 0 && lx + mw(env, MON[m], 11) <= w) { body += t(lx, top + sh + 16, MON[m], 'tick'); lastX = lx; } } });
    return svg(w, h, body, 'Scheduled inspections done on time, per week');
  }

  /** Action ageing dot-strip: every open action is one dot, rows by priority, position = age, filled = overdue. */
  function dotStrip(env, rows, counts, metrics, w) {
    var groups = PRIORITIES.map(function (p) { return { p: p, rows: rows.filter(function (r) { return (r.priority === 'other' ? 'none' : r.priority) === p; }) }; }).filter(function (g) { return g.rows.length; });
    if (!groups.length) return '';
    var sub = function (g) { var c = counts[g.p]; return fmt(c === undefined ? g.rows.length : c.open) + ' open, ' + fmt(c === undefined ? 0 : c.overdue) + ' overdue'; };
    var narrow = w < 560;
    var lw = narrow ? 0 : Math.ceil(Math.max.apply(null, groups.map(function (g) { return Math.max(mw(env, PR_LABEL[g.p], 12.5), mw(env, sub(g), 11.5)); }))) + 20;
    var maxAge = Math.max.apply(null, rows.map(function (r) { return r.age_days; }));
    // Square-root age axis: young actions (most of them) get room, the long tail still fits. Ticks sit on the
    // backlog analytic's band edges so the scale reads at a glance.
    var hiAge = [30, 90, 180, 365, 730, 1095, 1825].filter(function (v) { return v >= maxAge; })[0] || Math.ceil(maxAge / 365) * 365;
    var ticks = [0, 7, 30, 90, 180, 365, 730, 1095, 1825].filter(function (v) { return v <= hiAge; });
    var top = 34, rowH = narrow ? 78 : 60, h = top + groups.length * rowH + 30, x0 = lw + 8, x1 = w - 12, body = '';
    var x = function (v) { return x0 + (Math.sqrt(Math.max(0, v)) / Math.sqrt(hiAge)) * (x1 - x0); };
    var lastTx = -99;
    ticks.forEach(function (v) {
      var cls = v === 7 || v === 30 || v === 90 ? 'ref' : 'gl';
      body += '<line class="' + cls + '" x1="' + r1(x(v)) + '" x2="' + r1(x(v)) + '" y1="' + (top - 6) + '" y2="' + (h - 26) + '"/>';
      var lab = v === 0 ? '0' : v + ' d', tw2 = mw(env, lab, 11);
      if (x(v) - tw2 / 2 > lastTx + 6) { body += x(v) + tw2 / 2 > w ? t(w, h - 8, lab, 'tick', 'end') : t(x(v), h - 8, lab, 'tick', 'middle'); lastTx = x(v) + tw2 / 2; }
    });
    var bands = [[0, 7, metrics.age_0_7, '0-7 d'], [7, 30, metrics.age_8_30, '8-30 d'], [30, 90, metrics.age_31_90, '31-90 d'], [90, hiAge, metrics.age_90_plus, '90+ d']];
    bands.forEach(function (b) {
      if (b[0] >= hiAge) return;
      var xa = x(b[0]), xb = x(Math.min(b[1], hiAge)), lab = b[3] + ': ' + fmt(b[2]);
      if (xb - xa > mw(env, lab, 11) + 10) body += t((xa + xb) / 2, top - 14, lab, 'ann', 'middle');
    });
    var di = 0;
    groups.forEach(function (g, gi) {
      var y0 = top + gi * rowH, cy = y0 + rowH / 2;
      if (!narrow) body += t(1, cy - 2, PR_LABEL[g.p], 'lbl') + t(1, cy + 13, sub(g), 'lbl2');
      else body += t(1, y0 + 12, PR_LABEL[g.p] + ' \u00b7 ' + sub(g), 'lbl2');
      body += '<line class="axis" x1="' + x0 + '" x2="' + x1 + '" y1="' + r1(y0 + rowH) + '" y2="' + r1(y0 + rowH) + '"/>';
      var mid = narrow ? y0 + 20 + (rowH - 20) / 2 : cy, spread = narrow ? (rowH - 20) / 2 - 7 : (rowH - 18) / 2;
      g.rows.forEach(function (r) {
        var jx = x(r.age_days), jy = mid + (hash(r.id) * 2 - 1) * spread, over = r.overdue_days !== null;
        var tip = { t: r.title, s: r.site + ' \u00b7 ' + PR_LABEL[r.priority] + ' priority', r: [['Open for', fmt(r.age_days) + ' days'], ['Due', r.due ? dayLabel(r.due) : 'no due date']].concat(over ? [['Overdue by', fmt(r.overdue_days) + ' days', 'worse']] : []), n: href(r.href) ? 'Click to open in Mitti.' : '' };
        body += '<g data-i="' + (di++) + '"' + tipAttr(tip) + (href(r.href) ? ' data-href="' + esc(r.href) + '"' : '') + '><circle class="hit" cx="' + r1(jx) + '" cy="' + r1(jy) + '" r="8"/><circle class="pr-' + (r.priority === 'other' ? 'none' : r.priority) + (over ? '' : ' ring') + ' hl" cx="' + r1(jx) + '" cy="' + r1(jy) + '" r="' + (narrow ? 4 : 4.5) + '"/></g>';
      });
    });
    return svg(w, h, body, 'Open actions by age and priority');
  }

  /** Site dumbbell: average score this period (solid) vs previous (hollow); the line is coloured by direction. */
  function dumbbell(env, rows, selSk, w) {
    if (!rows.length) return '';
    var narrow = w < 480;
    var vals = []; rows.forEach(function (r) { vals.push(r.average_score, r.previous_average_score); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var dm = domain(lo - 0.5, Math.min(100, hi + 0.5), 4, false);
    dm.hi = Math.min(dm.hi, 100); dm.ticks = dm.ticks.filter(function (v) { return v <= 100; });
    var chW = Math.ceil(Math.max.apply(null, rows.map(function (r) { return mw(env, signed(r.score_change, ' pts'), 12, 600); }))) + 10;
    var lw = narrow ? 0 : Math.min(Math.round(w * 0.32), Math.ceil(Math.max.apply(null, rows.map(function (r) { return mw(env, r.site, 12.5); }))) + 14);
    var vw = Math.ceil(mw(env, '100.0', 12, 600)) + 10;
    var top = 22, rowH = narrow ? 46 : 32, h = top + rows.length * rowH + 26;
    var x = lin(dm.lo, dm.hi, lw + vw, w - chW - vw - 8), body = '';
    dm.ticks.forEach(function (v) { body += '<line class="gl" x1="' + r1(x(v)) + '" x2="' + r1(x(v)) + '" y1="' + (top - 4) + '" y2="' + (h - 22) + '"/>' + t(x(v), h - 6, fmt(v, '%'), 'tick', 'middle'); });
    body += t(w, 12, 'Change', 'ann', 'end');
    rows.forEach(function (r, i) {
      var y0 = top + i * rowH, cy = narrow ? y0 + 30 : y0 + rowH / 2, a = x(r.previous_average_score), b = x(r.average_score);
      var dir = r.score_change > 0 ? 'up' : r.score_change < 0 ? 'down' : 'flat', faded = selSk && r.sk !== selSk;
      var tip = { t: r.site, s: 'Rank ' + r.rank + ' of ' + rows.length + ' by composite', r: [['Average score now', fmt(r.average_score, '%')], ['Previous period', fmt(r.previous_average_score, '%')], ['Change', signed(r.score_change, ' pts'), judge(r.score_change, 'up')], ['Inspections now / before', fmt(r.inspections) + ' / ' + fmt(r.previous_inspections)]], n: '' };
      body += '<g data-i="' + i + '"' + tipAttr(tip) + (faded ? ' class="faded"' : '') + '><rect class="hit" x="0" y="' + y0 + '" width="' + w + '" height="' + rowH + '"/>';
      body += t(1, narrow ? y0 + 14 : cy + 4, clip(env, r.site, 12.5, narrow ? w - chW - 8 : lw - 14), 'lbl');
      body += '<line class="db-' + dir + '" x1="' + r1(a) + '" x2="' + r1(b) + '" y1="' + r1(cy) + '" y2="' + r1(cy) + '"/>';
      body += '<circle class="db-prev" cx="' + r1(a) + '" cy="' + r1(cy) + '" r="5"/><circle class="db-cur" cx="' + r1(b) + '" cy="' + r1(cy) + '" r="5.5"/>';
      body += b >= a ? t(b + 10, cy + 4, fmtD(r.average_score, 1), 'val') : t(b - 10, cy + 4, fmtD(r.average_score, 1), 'val', 'end');
      body += '<text x="' + w + '" y="' + r1(narrow ? y0 + 14 : cy + 4) + '" text-anchor="end" class="val ' + (dir === 'flat' ? '' : dir) + '">' + esc(signedD(r.score_change, 1)) + '</text>';
      if (selSk && r.sk === selSk) body += '<rect class="sel-ring" x="' + r1(Math.min(a, b) - 9) + '" y="' + r1(cy - 9) + '" width="' + r1(Math.abs(b - a) + 18) + '" height="18" rx="9"/>';
      body += '</g>';
    });
    return svg(w, h, body, 'Average score by site, this period against the previous period');
  }

  /** One 100% bar: on time / late / missed among resolved occurrences, direct-labelled. */
  function outcomeBar(env, m, w) {
    var res = m.resolved || 0; if (!res) return '';
    var parts = [['stk-ok', 'On time', m.on_time, m.compliance_pct], ['stk-late', 'Late', m.late, m.late_pct], ['stk-miss', 'Missed', m.missed, m.missed_pct]];
    var h = 66, x = 0, body = '';
    parts.forEach(function (p, i) {
      var pw = (p[2] / res) * w; if (pw <= 0) return;
      body += '<g data-i="' + i + '"' + tipAttr({ t: p[1], s: 'Share of ' + fmt(res) + ' resolved occurrences', r: [['Occurrences', fmt(p[2])], ['Share', fmt(p[3], '%')]], n: '' }) + '><rect class="' + p[0] + '" x="' + r1(x) + '" y="24" width="' + r1(Math.max(1, pw - 2)) + '" height="22" rx="3"/>';
      var lab = p[1] + ' ' + fmt(p[3], '%');
      if (mw(env, lab, 12, 600) + 4 < pw || i === 0) body += t(x, 16, lab, 'val');
      body += '</g>';
      x += pw;
    });
    var tail = parts.slice(1).filter(function (p) { return p[2] > 0 && (p[2] / res) * w < mw(env, p[1] + ' ' + fmt(p[3], '%'), 12, 600) + 4; }).map(function (p) { return p[1] + ' ' + fmt(p[3], '%'); }).join(' · ');
    if (tail) body += t(w, 16, tail, 'valsoft', 'end');
    body += t(0, 62, fmt(m.on_time) + ' on time, ' + fmt(m.late) + ' late, ' + fmt(m.missed) + ' missed of ' + fmt(res) + ' resolved', 'ann');
    return svg(w, h, body, 'Outcome of resolved scheduled inspections');
  }

  // ---------------------------------------------------------------- tables
  function table(id, ctx, cols, rows, opts) {
    opts = opts || {};
    var st = (ctx.state.sort || {})[id] || opts.sort || null;
    var data = rows.slice();
    if (st) {
      var col = cols.filter(function (c) { return c.k === st.k; })[0];
      if (col) data.sort(function (a, b) { var x = col.v(a), y = col.v(b); if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x < y ? -1 : 1) * (st.d === 'asc' ? 1 : -1); });
    }
    var hd = cols.map(function (c) {
      var on = st && st.k === c.k, aria = on ? ' aria-sort="' + (st.d === 'asc' ? 'ascending' : 'descending') + '"' : '';
      return '<th scope="col"' + (c.num ? ' class="num"' : '') + aria + '><button type="button" data-sort="' + id + '" data-k="' + c.k + '">' + esc(c.label) + '<span class="ar" aria-hidden="true">' + (on ? (st.d === 'asc' ? '▲' : '▼') : '▽') + '</span></button></th>';
    }).join('');
    var dps = {}; cols.forEach(function (c) { if (c.fx) dps[c.k] = dpOf(rows.map(function (r) { return r[c.k]; })); });
    var body = data.map(function (r) { return '<tr' + (opts.sel && opts.sel(r) ? ' class="row-sel"' : '') + '>' + cols.map(function (c) { var cls = (c.num ? 'num' : '') + (c.nw ? ' nw' : '') + (c.cls ? ' ' + c.cls(r) : ''); return '<td' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '>' + (c.fx ? esc(fmtD(r[c.k], dps[c.k], c.unit)) : c.h(r)) + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<div class="tw" role="region" tabindex="0" aria-label="' + esc(opts.label || 'Table') + '"><table><caption class="sr">' + esc(opts.label || '') + ' (select a column heading to sort)</caption><thead><tr>' + hd + '</tr></thead><tbody>' + body + '</tbody></table></div>' + (opts.after || '');
  }
  function link(text, h) { var u = href(h); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : esc(text); }
  function n(k, label, fmtUnit, extra) { return Object.assign({ k: k, label: label, num: true, unit: fmtUnit || '', fx: !(extra && extra.h), v: function (r) { return r[k]; }, h: function (r) { return esc(fmt(r[k], fmtUnit)); } }, extra || {}); }

  // ---------------------------------------------------------------- views
  function ctxOf(data, state, env) {
    var period = data.periods.filter(function (p) { return p.key === state.period; })[0] || data.periods[0];
    var site = data.sites.filter(function (s) { return s.key === state.site; })[0] || null;
    var sk = site ? site.key : 'all';
    return { data: data, state: state, env: env, period: period, site: site, slice: data.slices[period.key + '|' + sk], scope: data.scopes[sk], window: data.windows[data.slices[period.key + '|' + sk].window] };
  }
  function scopeName(ctx) { return ctx.site ? ctx.site.name : ctx.data.scope_note; }
  function series(ctx, metric) { return ctx.scope.trends[ctx.slice.window][metric]; }

  function overview(ctx) {
    var s = ctx.slice.overview, charts = {}, html = '';
    html += head(ctx, 'Overview · ' + scopeName(ctx), 'Overview', 'Is safety performance getting better or worse this period?', markFirst(s.answer, s.tiles[2].value === null));
    html += '<div class="tiles">' + s.tiles.map(function (tl) { var id = tl.spark ? 'sp-' + tl.key : ''; if (id) charts[id] = sparkFor(ctx, tl.spark); return tile(tl, ctx, id); }).join('') + '</div>';
    var cal = ctx.scope.calendar;
    html += '<div class="grid">' + card(12, 'Inspections completed per day', 'Last 12 months, ' + rangeOf(ctx.data.year.label) + '. Stronger colour = more inspections; the bracket marks the selected period.',
      cal.unavailable ? unavailable(cal.unavailable) : chartSlot('cal', 'Inspections per day, calendar', 180) + calLegend(), '') + '</div>';
    if (!cal.unavailable) charts.cal = function (w) { return calendarChart(ctx.env, cal, ctx, w); };
    var ins = series(ctx, 'inspections_completed'), sc = series(ctx, 'average_score');
    var trendBody = ins.unavailable ? unavailable(ins.unavailable) : chartSlot('tr-ins', 'Inspections completed per ' + ins.grain, 200) + legend([['hollow', 'Hollow point = partial ' + ins.grain]].concat(bandLegend(ctx)));
    charts['tr-ins'] = function (w) { return lineChart(ctx.env, { series: [{ points: ins.points, name: '' }], unit: '', grain: ins.grain, zero: true, title: 'Inspections completed', name: 'Inspections', band: ctx.period, windowTo: ctx.window.to.slice(0, 10), good: 'up' }, w); };
    var att = s.attention.length ? '<ul class="att">' + s.attention.map(function (a) { return '<li><span class="sev s' + a.severity + '">' + ['', 'Overdue', 'Missed', 'Rising', 'New issue'][a.severity] + '</span><p>' + esc(a.text) + (href(a.href) ? ' ' + link('Open', a.href) : '') + '</p></li>'; }).join('') + '</ul>' : '<p class="empty">Nothing meets the attention rules this period: no overdue high-priority actions, missed schedules, failed-rate jumps of 10+ points or new high-priority issues.</p>';
    html += '<div class="grid">' + card(7, 'Inspections completed per ' + ins.grain, rangeOf(ctx.window.label) + trendText(ins), trendBody) + card(5, 'Needs attention', 'Top three by severity, from the safety pulse.', att) + '</div>';
    var scoreBody = sc.unavailable ? unavailable(sc.unavailable) : chartSlot('tr-score', 'Average score per ' + sc.grain, 200);
    charts['tr-score'] = function (w) { return lineChart(ctx.env, { series: [{ points: sc.points, name: '' }], unit: '%', grain: sc.grain, title: 'Average inspection score', name: 'Average score', band: ctx.period, windowTo: ctx.window.to.slice(0, 10), good: 'up' }, w); };
    var fr = series(ctx, 'failed_item_rate');
    var frBody = fr.unavailable ? unavailable(fr.unavailable) : chartSlot('tr-fr', 'Failed-item rate per ' + fr.grain, 200);
    charts['tr-fr'] = function (w) { return lineChart(ctx.env, { series: [{ points: fr.points, name: '' }], unit: '%', grain: fr.grain, zero: true, title: 'Failed-item rate', name: 'Failed-item rate', dp: 2, band: ctx.period, windowTo: ctx.window.to.slice(0, 10), good: 'down' }, w); };
    html += '<div class="grid">' + card(6, 'Average inspection score', 'Mean score of scored inspections, per ' + sc.grain + '. Axis starts near the data, not at zero.', scoreBody) + card(6, 'Failed-item rate', 'Failed answers as a share of answered items, per ' + fr.grain + trendText(fr), frBody) + '</div>';
    html += notes(s.caveats);
    return { html: html, charts: charts };
  }
  function bandLegend(ctx) { return ctx.slice.window === 'w' && ctx.period.key === '90d' ? [] : ctx.slice.window === 'm' && ctx.period.key === '12m' ? [] : [['band', 'Selected period']]; }
  function sparkFor(ctx, key) {
    if (key === 'missed' || key.indexOf('stripe:') === 0) {
      var st = ctx.scope.stripes; if (st.state !== 'ok') return null;
      var f = key === 'missed' ? 'missed' : key.slice(7);
      var wk = ctx.slice.window === 'm' ? st.weeks.filter(function (x, i) { return st.weeks.slice(0, i + 1).some(function (y) { return y.due; }); }) : st.weeks.slice(-13);
      return function (w) { return sparkline(wk.map(function (x) { return { value: x.due ? x[f] : null, partial: x.partial }; }), w); };
    }
    var s = series(ctx, key); if (!s || s.unavailable) return null;
    return function (w) { return sparkline(s.points, w); };
  }

  function inspections(ctx) {
    var s = ctx.slice.inspections, o = ctx.slice.overview, charts = {}, html = '';
    html += head(ctx, 'Inspections · ' + scopeName(ctx), 'Inspections', 'Which questions fail most, and is the failure rate moving?', markFirst(s.answer, Boolean(s.unavailable)));
    var tiles = [o.tiles[2], o.tiles[0], o.tiles[1]];
    var failedTile = s.unavailable ? { key: 'failed', label: 'Failed answers', unit: '', value: null, previous: null, delta: null, unavailable: s.unavailable } : { key: 'failed', label: 'Failed answers', unit: '', value: s.failed, previous: s.previous_failed, delta: s.failed_change, good: 'down', note: 'of ' + fmt(s.answered) + ' answered items' };
    html += '<div class="tiles n4">' + [failedTile].concat(tiles).map(function (tl) { var id = tl.spark ? 'sp2-' + tl.key : ''; if (id) charts[id] = sparkFor(ctx, tl.spark); return tile(tl, ctx, id); }).join('') + '</div>';
    var body = s.unavailable ? unavailable(s.unavailable) : !s.rows.length ? '<p class="empty">No failed answers in this period. This shows questions answered with a failing response, largest first.</p>' : chartSlot('pareto', 'Failed-item Pareto', 300) + legend([['mark', 'Questions that make up half of all failed answers'], ['soft', 'Other questions'], ['cum', 'Cumulative share']]);
    if (!s.unavailable && s.rows.length) charts.pareto = function (w) { return pareto(ctx.env, s, w); };
    html += '<div class="grid">' + card(12, 'Failed-item Pareto: where the failures concentrate', 'Top ' + s.rows.length + ' of ' + fmt(s.groups) + ' failing questions, ' + ctx.period.long.toLowerCase() + '. The right panel accumulates their share of all ' + fmt(s.failed) + ' failed answers.', body) + '</div>';
    var fr = series(ctx, 'failed_item_rate'), sc = series(ctx, 'average_score');
    charts['i-fr'] = function (w) { return lineChart(ctx.env, { series: [{ points: fr.points }], unit: '%', grain: fr.grain, zero: true, title: 'Failed-item rate', name: 'Failed-item rate', dp: 2, band: ctx.period, windowTo: ctx.window.to.slice(0, 10), good: 'down' }, w); };
    charts['i-sc'] = function (w) { return lineChart(ctx.env, { series: [{ points: sc.points }], unit: '%', grain: sc.grain, title: 'Average score', name: 'Average score', band: ctx.period, windowTo: ctx.window.to.slice(0, 10), good: 'up' }, w); };
    html += '<div class="grid">' + card(6, 'Failed-item rate per ' + fr.grain, rangeOf(ctx.window.label) + trendText(fr), fr.unavailable ? unavailable(fr.unavailable) : chartSlot('i-fr', 'Failed-item rate trend', 200)) + card(6, 'Average score per ' + sc.grain, rangeOf(ctx.window.label) + trendText(sc), sc.unavailable ? unavailable(sc.unavailable) : chartSlot('i-sc', 'Average score trend', 200)) + '</div>';
    if (!s.unavailable && s.rows.length) {
      var cols = [n('rank', '#'), { k: 'label', label: 'Question', v: function (r) { return r.label.toLowerCase(); }, h: function (r) { return esc(r.label) + '<span class="s">' + esc(r.template) + '</span>'; } }, n('failed', 'Failed'), n('change', 'vs previous', '', { h: function (r) { return esc(signed(r.change)); }, cls: function (r) { return judge(r.change, 'down'); } }), n('answered', 'Answered'), rateCol('rate', 'Failure rate'), n('share', 'Share', '%'), n('cumulative', 'Cumulative', '%'), { k: 'href', label: 'Example', v: function (r) { return r.href ? 1 : 0; }, h: function (r) { return href(r.href) ? link('Open', r.href) : ''; } }];
      html += '<div class="grid">' + card(12, 'Failed questions', 'Ranked by failed answers. Failure rate = failed / answered for the same question.', table('t-items', ctx, cols, s.rows, { label: 'Failed questions', sort: { k: 'rank', d: 'asc' } })) + '</div>';
    }
    html += notes(s.caveats);
    return { html: html, charts: charts };
  }

  function actions(ctx) {
    var s = ctx.slice.actions, o = ctx.slice.overview, charts = {}, html = '';
    html += head(ctx, 'Actions · ' + scopeName(ctx), 'Actions', 'How old is the open action backlog, and is it shrinking?', markFirst(s.answer, Boolean(s.unavailable)));
    if (s.unavailable) { html += '<div class="grid">' + card(12, 'Action backlog', '', unavailable(s.unavailable)) + '</div>' + notes(s.caveats); return { html: html, charts: charts }; }
    var m = s.metrics;
    var tl = [
      { key: 'open', label: 'Open actions', unit: '', value: m.open, previous: null, delta: null, note: 'snapshot now; ' + fmt(m.open_no_due_date) + ' without a due date' },
      { key: 'overdue', label: 'Overdue now', unit: '', value: m.overdue, previous: null, delta: null, note: fmt(m.overdue_90_plus) + ' overdue by more than 90 days' },
      o.action_tiles[0], Object.assign({}, o.action_tiles[1], s.closed_other === null ? {} : { sub: 'of ' + fmt(m.closed_in_period) + ' closed (' + fmt(s.closed_other) + ' without completing, such as can\'t do)' }),
      { key: 'median', label: 'Median days to close', unit: '', value: m.median_resolution_days, previous: null, delta: null, note: 'p90 ' + fmt(m.p90_resolution_days) + ' days; from ' + fmt(m.completed_in_period) + ' completed in the period' },
    ];
    html += '<div class="tiles n5">' + tl.map(function (x) { var id = x.spark ? 'sp3-' + x.key : ''; if (id) charts[id] = sparkFor(ctx, x.spark); return tile(x, ctx, id); }).join('') + '</div>';
    var dots = ctx.data.open_actions;
    var rows = dots.unavailable ? [] : dots.rows.filter(function (r) { return !ctx.site || r.sk === ctx.site.sk; });
    var counts = {}; s.by_priority.forEach(function (p) { counts[p.priority === 'other' ? 'none' : p.priority] = p; });
    var dsBody = dots.unavailable ? unavailable(dots.unavailable) : !rows.length ? '<p class="empty">No open actions. This chart shows every open action as a dot, placed by how long it has been open.</p>' : chartSlot('dots', 'Open actions by age and priority', 260) + legend([['pr-high dot', 'High'], ['pr-medium dot', 'Medium'], ['pr-low dot', 'Low'], ['pr-none dot', 'No priority'], ['pr-low ring', 'Hollow = not yet due']]);
    if (rows.length) charts.dots = function (w) { return dotStrip(ctx.env, rows, counts, m, w); };
    html += '<div class="grid">' + card(12, 'Every open action, by age', fmt(rows.length) + ' open actions as of now, placed by days since they were raised. Filled dots are overdue. Bands follow the backlog analytic: 0-7, 8-30, 31-90 and 90+ days. The age axis is square-root scaled so recent actions get room.', dsBody, 'Open actions by age now: <b>0-7 d</b> ' + esc(fmt(m.age_0_7)) + ' · <b>8-30 d</b> ' + esc(fmt(m.age_8_30)) + ' · <b>31-90 d</b> ' + esc(fmt(m.age_31_90)) + ' · <b>90+ d</b> ' + esc(fmt(m.age_90_plus)) + '.' + (dots.undated ? ' ' + esc(fmt(dots.undated)) + ' open actions have no created date and are not placed.' : '')) + '</div>';
    var pFrom = ctx.period.from.slice(0, 10), pTo = ctx.period.to.slice(0, 10);
    var wk = s.weekly.map(function (x) { return { bucket: x.week_start, from: x.week_start < pFrom ? pFrom : x.week_start, partial: x.week_start < pFrom || addDays(x.week_start, 7) > pTo, opened: x.opened, closed: x.closed }; });
    var useWeeks = wk.length >= 3 && wk.length <= 60;
    charts.flow = function (w) { return lineChart(ctx.env, { series: [{ points: wk.map(function (x) { return { bucket: x.bucket, from: x.from, value: x.opened, partial: x.partial }; }), name: 'Opened', cls: '' }, { points: wk.map(function (x) { return { bucket: x.bucket, from: x.from, value: x.closed, partial: x.partial }; }), name: 'Closed', cls: 'cum' }], unit: '', grain: 'week', zero: true, title: 'Actions opened and closed per week', name: '', windowTo: ctx.period.to.slice(0, 10) }, w); };
    var flowBody = useWeeks ? chartSlot('flow', 'Actions opened and closed per week', 200) + legend([['mark', 'Opened (created)'], ['cum', "Closed (completed or can't do)"], ['hollow', 'Hollow point = partial week']]) : '<p class="empty">' + esc(fmt(m.opened_in_period) + ' opened and ' + fmt(m.closed_in_period) + " closed (completed or can't do) in this period (too few weeks to chart).") + '</p>';
    var bySite = s.by_site.filter(function (g) { return g.overdue > 0 || g.open > 0; }).slice(0, 12);
    var siteBars = bySite.map(function (g) { return { label: g.group, value: g.overdue, valueText: fmt(g.overdue) + ' of ' + fmt(g.open), cls: ctx.site && g.sk === ctx.site.sk ? 'hot' : g.overdue ? 'risk' : '', tip: { t: g.group, s: 'Open actions now', r: [['Overdue', fmt(g.overdue)], ['Open', fmt(g.open)], ['No due date', fmt(g.no_due_date)], ['Oldest open', fmt(g.oldest_age_days) + ' days']], n: '' } }; });
    charts.bysite = function (w) { return hbars(ctx.env, { rows: siteBars, title: 'Overdue actions by site' }, w); };
    html += '<div class="grid">' + card(7, 'Opened against closed, per week', rangeOf(ctx.period.label) + ". Closed = completed or can't do. When opened runs above closed, the backlog grows.", flowBody) + card(5, ctx.site ? 'Overdue actions at this site' : 'Overdue actions by site', 'Overdue of open, now. Sorted by overdue count.', bySite.length ? chartSlot('bysite', 'Overdue actions by site', 120) : '<p class="empty">No open actions in scope.</p>') + '</div>';
    if (rows.length) {
      var cols = [{ k: 'title', label: 'Action', v: function (r) { return r.title.toLowerCase(); }, h: function (r) { return link(r.title, r.href) + '<span class="s">' + esc(r.site) + '</span>'; } }, { k: 'priority', label: 'Priority', v: function (r) { return PRIORITIES.indexOf(r.priority); }, h: function (r) { return '<span class="pill ' + esc(r.priority) + '">' + esc(PR_LABEL[r.priority] || r.priority) + '</span>'; } }, n('age_days', 'Open (days)'), { k: 'due', label: 'Due', v: function (r) { return r.due; }, h: function (r) { return esc(r.due ? dayLabel(r.due) : 'none'); } }, n('overdue_days', 'Days overdue', '', { h: function (r) { return r.overdue_days === null ? '' : esc(fmt(r.overdue_days)); }, cls: function (r) { return r.overdue_days !== null ? 'worse' : ''; } })];
      html += '<div class="grid">' + card(12, 'Open actions', 'Oldest first. Select a heading to sort.', table('t-actions', ctx, cols, rows, { label: 'Open actions', sort: { k: 'age_days', d: 'desc' } })) + '</div>';
    }
    html += notes(s.caveats);
    return { html: html, charts: charts };
  }

  function schedules(ctx) {
    var s = ctx.slice.schedules, charts = {}, html = '', st = ctx.scope.stripes;
    html += head(ctx, 'Schedules · ' + scopeName(ctx), 'Schedules', 'Are scheduled inspections being done on time?', markFirst(s.answer, s.state !== 'ok'));
    if (s.state !== 'ok') { html += '<div class="grid">' + card(12, 'Schedule compliance', '', s.state === 'empty' ? '<p class="empty">' + esc(s.reason) + '</p>' : unavailable(s.reason)) + '</div>' + notes(s.caveats); return { html: html, charts: charts }; }
    var m = s.metrics, c = s.changes;
    var lead = 0; if (st.state === 'ok') { while (lead < st.weeks.length && !st.weeks[lead].due) lead++; if (lead === st.weeks.length) lead = 0; }
    var stv = st.state === 'ok' && lead > 0 ? Object.assign({}, st, { weeks: st.weeks.slice(lead) }) : st;
    var tl = [
      { key: 'on', label: 'Done on time', unit: '%', value: m.compliance_pct, previous: s.previous ? s.previous.compliance_pct : null, delta: c.compliance_pct, good: 'up', spark: 'stripe:compliance_pct', note: m.compliance_pct === null ? 'nothing resolved yet' : fmt(m.on_time) + ' of ' + fmt(m.resolved) + ' resolved' },
      { key: 'late', label: 'Done late', unit: '%', value: m.late_pct, previous: s.previous ? s.previous.late_pct : null, delta: c.late_pct, good: 'down', spark: 'stripe:late', note: fmt(m.late) + ' occurrences' },
      { key: 'missed', label: 'Missed', unit: '%', value: m.missed_pct, previous: s.previous ? s.previous.missed_pct : null, delta: c.missed_pct, good: 'down', spark: 'missed', note: fmt(m.missed) + ' occurrences' },
      { key: 'due', label: 'Occurrences due', unit: '', value: m.due, previous: s.previous ? s.previous.due : null, delta: c.due, spark: 'stripe:due', note: fmt(m.pending) + ' still open, ' + fmt(m.wont_do) + " won't do" },
    ];
    html += '<div class="tiles n4">' + tl.map(function (x) { var id = x.spark ? 'sp4-' + x.key : ''; if (id) charts[id] = sparkFor(ctx, x.spark); return tile(x, ctx, id); }).join('') + '</div>';
    charts.stripes = function (w) { return stripesChart(ctx.env, stv, ctx, w); };
    html += '<div class="grid">' + card(12, 'On-time share, week by week', (lead ? 'From ' + dayLabel(stv.weeks[0].week) : 'Last 12 months') + ', one stripe per week. Darker red = a lower share done on time; dashed outline = nothing resolved that week. Bars below show how many were due.',
      st.state === 'ok' ? chartSlot('stripes', 'Weekly schedule compliance stripes', 190) + legend([['q0', '95% or more on time'], ['q1', '85 to 95%'], ['q2', '70 to 85%'], ['q3', '50 to 70%'], ['q4', 'Under 50%']]) : unavailable(st.reason),
      lead ? 'No scheduled inspections were due before ' + esc(monthLabel(stv.weeks[0].week)) + ', so the ' + esc(fmt(lead)) + ' earlier weeks of the 12-month window are left out.' : '') + '</div>';
    charts.outcome = function (w) { return outcomeBar(ctx.env, m, w); };
    var sites = s.by_site.filter(function (r) { return r.resolved > 0; }).slice(0, 12);
    var cDp = dpOf(sites.map(function (r) { return r.compliance_pct; }));
    var bars = sites.map(function (r) { return { label: r.group, value: r.compliance_pct, valueText: fmtD(r.compliance_pct, cDp, '%'), cls: r.compliance_pct !== null && r.compliance_pct < 80 ? 'risk' : '', tip: { t: r.group, s: 'Scheduled inspections, ' + ctx.period.long.toLowerCase(), r: [['On time', fmt(r.compliance_pct, '%')], ['On time / late / missed', fmt(r.on_time) + ' / ' + fmt(r.late) + ' / ' + fmt(r.missed)], ['Resolved', fmt(r.resolved)]], n: '' } }; });
    charts.schsites = function (w) { return hbars(ctx.env, { rows: bars, max: 100, unit: '%', title: 'On-time share by site' }, w); };
    html += '<div class="grid">' + card(12, 'How resolved occurrences ended', rangeOf(ctx.period.label) + '. Won’t-do and still-open occurrences are outside this bar.', m.resolved ? chartSlot('outcome', 'Outcome split', 70) : '<p class="empty">Nothing resolved yet in this period.</p>') +
      '</div><div class="grid">' + (ctx.site ? '' : card(12, 'Lowest on-time share by site', 'Lowest first. Red marks sites under 80%.', sites.length ? chartSlot('schsites', 'On-time share by site', 120) : '<p class="empty">No resolved occurrences attributed to a site.</p>')) + '</div>';
    var cols = [{ k: 'group', label: 'Schedule', v: function (r) { return r.group.toLowerCase(); }, h: function (r) { return esc(r.group); } }, n('due', 'Due'), n('on_time', 'On time'), n('late', 'Late'), n('missed', 'Missed', '', { cls: function (r) { return r.missed ? 'worse' : ''; } }), n('pending', 'Open'), n('compliance_pct', 'On-time share', '%')];
    html += '<div class="grid">' + card(12, 'Schedules', 'Lowest on-time share first.', s.by_schedule.length ? table('t-sched', ctx, cols, s.by_schedule, { label: 'Schedules', sort: { k: 'compliance_pct', d: 'asc' } }) : '<p class="empty">No occurrences were due in this period.</p>') + '</div>';
    html += notes(s.caveats);
    return { html: html, charts: charts };
  }

  function sites(ctx) {
    var L = ctx.data.league[ctx.period.key], charts = {}, html = '', selSk = ctx.site ? ctx.site.sk : null;
    html += head(ctx, 'Sites · ' + (ctx.site ? ctx.site.name + ' highlighted' : ctx.data.scope_note), 'Sites', 'Which sites are improving, and which are slipping?', markFirst(L.answer, Boolean(L.unavailable)));
    if (L.unavailable) { html += '<div class="grid">' + card(12, 'Site league', '', unavailable(L.unavailable)) + '</div>' + notes(L.caveats); return { html: html, charts: charts }; }
    var rows = L.rows.filter(function (r) { return r.score_change !== null; }).sort(function (a, b) { return b.score_change - a.score_change || a.rank - b.rank; });
    charts.db = function (w) { return dumbbell(ctx.env, rows, selSk, w); };
    html += '<div class="grid">' + card(12, 'Average score, this period against the last', 'Sites with at least ' + ctx.data.league_min_inspections + ' completed inspections in both periods, most improved first. ' + rangeOf(ctx.period.label) + ' against ' + rangeOf(ctx.period.previous_label) + '.',
      rows.length ? chartSlot('db', 'Site dumbbell', 220) + legend([['prev', 'Previous period'], ['cur', 'This period'], ['ok-line', 'Higher now'], ['risk-line', 'Lower now']]) : '<p class="empty">Too few sites qualify in both periods to compare. This chart pairs each site’s average score now with the previous period.</p>',
      ctx.site && !rows.some(function (r) { return r.sk === selSk; }) ? esc(ctx.site.name) + ' is not in the comparison (fewer than ' + ctx.data.league_min_inspections + ' inspections in one of the periods).' : '') + '</div>';
    var fr = L.rows.filter(function (r) { return r.failed_item_rate !== null; }).slice().sort(function (a, b) { return b.failed_item_rate - a.failed_item_rate; });
    var frDp = dpOf(fr.map(function (r) { return r.failed_item_rate; }));
    var bars = fr.map(function (r, i) { return { label: r.site, value: r.failed_item_rate, valueText: rate(r.failed_item_rate), cls: selSk ? (r.sk === selSk ? 'hot' : '') : i < 3 ? 'hot' : '', faded: false, sel: selSk && r.sk === selSk, tip: { t: r.site, s: 'Rank ' + r.rank + ' by composite', r: [['Failed-item rate', rate(r.failed_item_rate)], ['Inspections', fmt(r.inspections)], ['Overdue actions', fmt(r.overdue_actions)]], n: '' } }; });
    charts.frsites = function (w) { return hbars(ctx.env, { rows: bars, unit: '%', title: 'Failed-item rate by site' }, w); };
    var od = L.rows.filter(function (r) { return r.overdue_actions !== null; }).slice().sort(function (a, b) { return b.overdue_actions - a.overdue_actions || a.rank - b.rank; });
    var obars = od.map(function (r) { return { label: r.site, value: r.overdue_actions, valueText: fmt(r.overdue_actions), cls: selSk ? (r.sk === selSk ? 'hot' : '') : r.overdue_actions ? 'risk' : '', sel: selSk && r.sk === selSk, tip: { t: r.site, s: 'Open overdue actions at the end of the period', r: [['Overdue actions', fmt(r.overdue_actions)], ['Median days to close', fmt(r.median_resolution_days)]], n: '' } }; });
    charts.odsites = function (w) { return hbars(ctx.env, { rows: obars, title: 'Overdue actions by site' }, w); };
    html += '<div class="grid">' + card(6, 'Failed-item rate by site', 'Highest first; the three highest are dark.', bars.length ? chartSlot('frsites', 'Failed-item rate by site', 160) : unavailable('No failed-item rates for this period.')) + card(6, 'Open overdue actions by site', 'Counted at the end of the period. Scales with site size.', obars.length ? chartSlot('odsites', 'Overdue actions by site', 160) : unavailable('No action figures for this period.')) + '</div><div class="grid">' + card(12, 'Site league', 'Ranked by a composite of inspections, average score, failed-item rate, overdue actions and days to close. A relative ranking among these sites, not a safety rating.', table('t-league', ctx, [n('rank', '#'), { k: 'site', label: 'Site', nw: true, v: function (r) { return r.site.toLowerCase(); }, h: function (r) { return esc(r.site); } }, n('inspections', 'Inspections'), n('average_score', 'Avg score', '%'), n('score_change', 'Change', '', { h: function (r) { return esc(signedD(r.score_change, 1, ' pts')); }, cls: function (r) { return judge(r.score_change, 'up'); } }), rateCol('failed_item_rate', 'Failed rate'), n('overdue_actions', 'Overdue'), n('median_resolution_days', 'Days to close'), n('rank_change', 'Rank move', '', { h: function (r) { return esc(r.rank_change === null ? 'new' : signed(r.rank_change)); }, cls: function (r) { return judge(r.rank_change, 'up'); } })], L.rows, { label: 'Site league', sort: { k: 'rank', d: 'asc' }, sel: function (r) { return selSk && r.sk === selSk; }, after: L.below_minimum.length ? '<p class="foot">Below the ' + ctx.data.league_min_inspections + '-inspection minimum: ' + L.below_minimum.map(function (b) { return esc(b.site) + ' (' + esc(fmt(b.inspections)) + ')'; }).join(', ') + '.</p>' : '' })) + '</div>';
    html += notes(L.caveats, selSk ? ['The site filter highlights a site here; the league always compares every site in scope.'] : []);
    return { html: html, charts: charts };
  }

  function team(ctx) {
    var s = ctx.slice.team, charts = {}, html = '';
    html += head(ctx, 'People and templates · ' + scopeName(ctx), 'People and templates', 'Who is doing the inspections, and which templates find problems?', markFirst(s.answer, Boolean(s.inspectors_unavailable)));
    var top = s.inspector_rows.slice(0, 12);
    var flagged = s.outlier_index === null || s.outlier_index === undefined ? null : s.inspector_rows[s.outlier_index];
    var bars = top.map(function (r, i) { return { label: r.inspector_name, value: r.inspections, valueText: fmt(r.inspections) + (r === flagged ? ' (very fast)' : ''), cls: r === flagged ? 'risk' : '', tip: { t: r.inspector_name, s: 'Rank ' + (i + 1) + ' of ' + fmt(s.inspectors) + ' inspectors by volume', r: [['Inspections', fmt(r.inspections)], ['Share of all', fmt(r.share_pct, '%')], ['Templates used', fmt(r.templates)], ['Median minutes', fmt(r.median_minutes)]], n: r === flagged ? fmt(r.very_fast_share, '%') + ' of ' + fmt(r.very_fast_eligible) + ' timed inspections were very fast (under a quarter of the template median). A prompt for a conversation, not a performance score.' : 'Descriptive only: volume depends on role and roster.' } }; });
    var otherNote = s.other_inspectors > 0 && s.other_inspections !== null ? 'The other ' + esc(fmt(s.other_inspectors)) + ' inspectors completed <b>' + esc(fmt(s.other_inspections)) + '</b> inspections between them.' : '';
    charts.people = function (w) { return hbars(ctx.env, { rows: bars, title: 'Inspections by inspector' }, w); };
    var tpl = s.templates.filter(function (x) { return x.answered > 0; }).slice().sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); }).slice(0, 12);
    var tDp = dpOf(tpl.map(function (x) { return x.rate; }));
    var tbars = tpl.map(function (x, i) { var small = x.answered < 20; return { label: x.group, value: x.rate, valueText: rate(x.rate) + (small ? ' (n=' + x.answered + ')' : ''), cls: small ? '' : i < 3 ? 'hot' : '', tip: { t: x.group, s: 'Failed-item rate, ' + ctx.period.long.toLowerCase(), r: [['Failed-item rate', rate(x.rate)], ['Failed / answered', fmt(x.failed) + ' / ' + fmt(x.answered)], ['Share of all failed', fmt(x.share, '%')]], n: small ? 'Small sample: fewer than 20 answered items.' : '' } }; });
    charts.tpl = function (w) { return hbars(ctx.env, { rows: tbars, unit: '%', title: 'Failed-item rate by template' }, w); };
    html += '<div class="grid">' + card(6, 'Inspections by inspector', 'Top 12 by volume, ' + ctx.period.long.toLowerCase() + '. Descriptive, not a performance score' + (flagged ? '; red marks the inspector the headline describes.' : '.'), s.inspectors_unavailable ? unavailable(s.inspectors_unavailable) : bars.length ? chartSlot('people', 'Inspections by inspector', 200) : '<p class="empty">No completed inspections in this period.</p>', s.inspectors_unavailable ? '' : otherNote) +
      card(6, 'Failed-item rate by template', 'Templates whose questions failed at least once, highest rate first; the three highest are dark. Grey with n = small sample.', s.templates_unavailable ? unavailable(s.templates_unavailable) : tbars.length ? chartSlot('tpl', 'Failed-item rate by template', 200) : '<p class="empty">No failed answers in this period.</p>') + '</div>';
    if (!s.inspectors_unavailable && s.inspector_rows.length) {
      var cols = [{ k: 'inspector_name', label: 'Inspector', nw: true, v: function (r) { return String(r.inspector_name).toLowerCase(); }, h: function (r) { return esc(r.inspector_name); } }, n('inspections', 'Inspections'), n('share_pct', 'Share', '%'), n('templates', 'Templates'), n('median_minutes', 'Median minutes'), rateCol('failed_item_rate', 'Failed rate'), rateCol('expected_rate', 'Same-template rate'), n('difference_pp', 'Difference', '', { h: function (r) { return esc(signedD(r.difference_pp, 1, ' pts')); } }), n('very_fast_share', 'Very fast', '%', { h: function (r) { return esc(fmt(r.very_fast_share, '%')) + (r === flagged && r.very_fast_eligible ? '<span class="s">of ' + esc(fmt(r.very_fast_eligible)) + ' timed</span>' : ''); }, cls: function (r) { return r === flagged ? 'worse' : ''; } })];
      html += '<div class="grid">' + card(12, 'Inspector activity', 'Same-template rate = the organisation’s failed-item rate on the templates this person used, so people are compared on the same mix. A lower rate can mean safer areas as easily as lighter inspections.', table('t-people', ctx, cols, s.inspector_rows, { label: 'Inspector activity', sort: { k: 'inspections', d: 'desc' }, sel: function (r) { return r === flagged; }, after: s.truncated ? '<p class="foot">Showing ' + s.inspector_rows.length + ' of ' + s.total + ' inspectors (busiest first); figures above cover all of them.</p>' : '' })) + '</div>';
    }
    html += notes(s.caveats);
    return { html: html, charts: charts };
  }

  var VIEWS = { overview: overview, inspections: inspections, actions: actions, schedules: schedules, sites: sites, team: team };
  var NAMES = { overview: 'Overview', inspections: 'Inspections', actions: 'Actions', schedules: 'Schedules', sites: 'Sites', team: 'People and templates' };

  function footer(data) {
    var rows = data.coverage.map(function (c) { return '<tr><td>' + esc(c.feed) + '</td><td class="num">' + esc(fmt(c.rows)) + '</td><td>' + esc(c.last_synced) + '</td><td>' + esc(c.state) + '</td></tr>'; }).join('');
    return '<footer class="foot-data" id="about"><h2>About this data</h2><p>Computed locally by safetyculture-mcp from cached Mitti Data Feeds, as of ' + esc(data.generated_at) + '. Organisation shown as fingerprint <code>' + esc(data.fingerprint) + '</code>, not a name. A feed that is missing or partial makes related figures unavailable or understated, never zero.</p><div class="tw"><table><thead><tr><th scope="col"><button type="button" tabindex="-1">Feed</button></th><th scope="col" class="num"><button type="button" tabindex="-1">Rows</button></th><th scope="col"><button type="button" tabindex="-1">Last synced</button></th><th scope="col"><button type="button" tabindex="-1">Coverage</button></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (data.coverage_caveats.length ? '<ul>' + data.coverage_caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') + '<p class="disclaimer">Independent open-source project. Not affiliated with, endorsed by or supported by SafetyCulture Pty Ltd or Mitti.</p></footer>';
  }

  function view(data, state, env) {
    var ctx = ctxOf(data, state, env);
    var v = (VIEWS[state.view] || overview)(ctx);
    return { html: '<article class="view" aria-labelledby="view-title">' + v.html + '</article>', charts: v.charts, ctx: ctx };
  }

  function chips(data, state) {
    var ctx = ctxOf(data, state, null);
    return '<span class="chip static">Period <b>' + esc(ctx.period.long) + '</b> ' + esc(rangeOf(ctx.period.label)) + '</span><span class="chip static">Compared with <b>' + esc(rangeOf(ctx.period.previous_label)) + '</b></span>' +
      (ctx.site ? '<span class="chip">Site <b>' + esc(ctx.site.name) + '</b><button type="button" data-clear-site aria-label="Clear the site filter">×</button></span>' : '<span class="chip static">Site <b>' + esc(data.scope_note) + '</b></span>');
  }
  function navCounts(data, state) {
    var ctx = ctxOf(data, state, null), out = {};
    var a = ctx.slice.actions; if (!a.unavailable && a.metrics.overdue) out.actions = ['risk', fmt(a.metrics.overdue)];
    var s = ctx.slice.schedules; if (s.state === 'ok' && s.metrics.compliance_pct !== null) out.schedules = ['', fmt(s.metrics.compliance_pct, '%')];
    return out;
  }

  return { esc: esc, fmt: fmt, view: view, chips: chips, navCounts: navCounts, footer: footer, NAMES: NAMES, VIEWS: Object.keys(VIEWS), tipHtml: tipHtml };

  function tipHtml(tp) {
    return '<p class="tt">' + esc(tp.t) + '</p>' + (tp.s ? '<p class="ts">' + esc(tp.s) + '</p>' : '') + (tp.r && tp.r.length ? '<dl>' + tp.r.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="' + esc(r[2]) + '"' : '') + '>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' : '') + (tp.n ? '<p class="tn">' + esc(tp.n) + '</p>' : '');
  }
})();

(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var root = document.documentElement, main = document.getElementById('main'), tip = document.getElementById('tip'), live = document.getElementById('live');
  var canvas = document.createElement('canvas').getContext('2d');
  var family = getComputedStyle(document.body).fontFamily;
  var env = { measure: function (s, size, weight) { canvas.font = (weight || 400) + ' ' + size + 'px ' + family; return canvas.measureText(s).width; } };
  var data = null, state = { view: 'overview', period: '', site: 'all', sort: {} }, charts = {}, lastW = 0;

  // theme: stored choice, else the system preference
  var stored = null; try { stored = localStorage.getItem('scmcp-dashboard-theme'); } catch (e) { stored = null; }
  setTheme(stored || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
  function setTheme(t, save) {
    root.setAttribute('data-theme', t);
    var b = document.getElementById('theme'); if (b) { b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); b.querySelector('span').textContent = t === 'dark' ? 'Dark theme' : 'Light theme'; }
    if (save) try { localStorage.setItem('scmcp-dashboard-theme', t); } catch (e) { /* file:// without storage */ }
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, ''), parts = h.split('?'), v = parts[0], q = {};
    (parts[1] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    state.view = R.VIEWS.indexOf(v) >= 0 ? v : 'overview';
    state.period = data.periods.some(function (p) { return p.key === q.period; }) ? q.period : data.default_period;
    state.site = data.sites.some(function (s) { return s.key === q.site; }) ? q.site : 'all';
  }
  function hashFor(v, period, site) { return '#/' + v + '?period=' + period + (site && site !== 'all' ? '&site=' + site : ''); }
  function go(v, period, site) { var hsh = hashFor(v, period, site); if (location.hash === hsh) render(); else location.hash = hsh; }

  function render(keepScroll) {
    hideTip();
    var out = R.view(data, state, env);
    main.innerHTML = out.html + R.footer(data);
    charts = out.charts;
    drawCharts();
    document.getElementById('chips').innerHTML = R.chips(data, state);
    document.querySelectorAll('[data-period]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-period') === state.period ? 'true' : 'false'); });
    document.getElementById('site').value = state.site;
    var counts = R.navCounts(data, state);
    document.querySelectorAll('a.item').forEach(function (a) {
      var v = a.getAttribute('data-view');
      a.setAttribute('href', hashFor(v, state.period, state.site));
      if (v === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      var c = a.querySelector('.count'); var k = counts[v];
      c.textContent = k ? k[1] : ''; c.className = 'count' + (k && k[0] ? ' ' + k[0] : ''); c.hidden = !k;
    });
    document.title = R.NAMES[state.view] + ' · Safety dashboard';
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function drawCharts() {
    lastW = main.clientWidth;
    document.querySelectorAll('[data-chart]').forEach(function (el) {
      var f = charts[el.getAttribute('data-chart')];
      el.innerHTML = f ? f(Math.max(120, Math.floor(el.clientWidth))) || '' : '';
      el.style.minHeight = '0';
    });
  }

  // ---------- tooltips (pointer and keyboard)
  var tipEl = null;
  function showTip(el, x, y) {
    var raw = el.getAttribute('data-tip'); if (!raw) return;
    var tp; try { tp = JSON.parse(raw); } catch (e) { return; }
    tip.innerHTML = R.tipHtml(tp);
    tip.classList.add('show');
    var r = tip.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var left = x + 14, top = y + 14;
    if (left + r.width > vw - 8) left = Math.max(8, x - r.width - 14);
    if (top + r.height > vh - 8) top = Math.max(8, y - r.height - 14);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    if (tipEl && tipEl !== el) tipEl.classList.remove('on');
    tipEl = el; el.classList.add('on');
  }
  function hideTip() { tip.classList.remove('show'); if (tipEl) tipEl.classList.remove('on'); tipEl = null; }
  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) showTip(el, e.clientX, e.clientY); else if (tipEl && !tipEl.matches(':focus')) hideTip();
  });
  document.addEventListener('pointerleave', hideTip);
  document.addEventListener('scroll', function () { if (tipEl && !document.activeElement.closest('[data-chart]')) hideTip(); }, { passive: true });
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el.classList && el.classList.contains('tile')) { var b = el.getBoundingClientRect(); showTip(el, b.left + 8, b.bottom - 6); announce(el); }
  });
  document.addEventListener('focusout', function (e) { if (e.target.classList && (e.target.classList.contains('tile') || e.target.hasAttribute('data-chart'))) hideTip(); });
  function announce(el) { try { var tp = JSON.parse(el.getAttribute('data-tip')); live.textContent = [tp.t, tp.s].concat((tp.r || []).map(function (r) { return r[0] + ': ' + r[1]; })).concat(tp.n ? [tp.n] : []).filter(Boolean).join('. '); } catch (e) { /* ignore */ } }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideTip(); return; }
    var box = e.target.closest ? e.target.closest('[data-chart]') : null;
    if (!box || e.target !== box) return;
    var marks = box.querySelectorAll('[data-tip]'); if (!marks.length) return;
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 0, End: 0 };
    if (!(e.key in keys)) { if (e.key === 'Enter' && tipEl && tipEl.getAttribute('data-href')) window.open(tipEl.getAttribute('data-href'), '_blank', 'noopener'); return; }
    e.preventDefault();
    var cur = Array.prototype.indexOf.call(marks, tipEl), next = e.key === 'Home' ? 0 : e.key === 'End' ? marks.length - 1 : cur < 0 ? 0 : Math.min(marks.length - 1, Math.max(0, cur + keys[e.key]));
    var m = marks[next], b = m.getBoundingClientRect();
    showTip(m, b.left + b.width / 2, b.top + b.height / 2);
    announce(m);
  });
  document.addEventListener('click', function (e) {
    var s = e.target.closest('[data-sort]');
    if (s) { var id = s.getAttribute('data-sort'), k = s.getAttribute('data-k'), cur = state.sort[id]; state.sort[id] = { k: k, d: cur && cur.k === k && cur.d === 'desc' ? 'asc' : 'desc' }; var y = window.scrollY; render(true); window.scrollTo(0, y); var again = document.querySelector('[data-sort="' + id + '"][data-k="' + k + '"]'); if (again) again.focus(); return; }
    var p = e.target.closest('[data-period]'); if (p) { go(state.view, p.getAttribute('data-period'), state.site); return; }
    if (e.target.closest('[data-clear-site]')) { go(state.view, state.period, 'all'); return; }
    var hrefEl = e.target.closest('[data-href]'); if (hrefEl && hrefEl.closest('svg')) { window.open(hrefEl.getAttribute('data-href'), '_blank', 'noopener'); return; }
    if (e.target.closest('#theme')) { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true); return; }
    if (e.target.closest('#print')) { window.print(); return; }
  });
  document.getElementById('site').addEventListener('change', function (e) { go(state.view, state.period, e.target.value); });
  window.addEventListener('hashchange', function () { parseHash(); render(); });
  var pending = 0;
  function onResize() { if (Math.abs(main.clientWidth - lastW) < 2) return; cancelAnimationFrame(pending); pending = requestAnimationFrame(function () { hideTip(); drawCharts(); }); }
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(main); else window.addEventListener('resize', onResize);

  // ---------- print: every view, stacked, with the current filters
  window.addEventListener('beforeprint', function () {
    var html = '', all = {};
    R.VIEWS.forEach(function (v) { var o = R.view(data, { view: v, period: state.period, site: state.site, sort: state.sort }, env); html += o.html; Object.keys(o.charts).forEach(function (k) { all[v + ':' + k] = o.charts[k]; }); html = html.replace(/data-chart="([^"]+)"/g, function (m0, id) { return id.indexOf(':') >= 0 ? m0 : 'data-chart="' + v + ':' + id + '"'; }); });
    main.innerHTML = html + R.footer(data);
    charts = all;
    document.querySelectorAll('details.notes').forEach(function (d) { d.open = true; });
    document.querySelectorAll('[data-chart]').forEach(function (el) { var f = charts[el.getAttribute('data-chart')]; el.innerHTML = f ? f(1000) || '' : ''; });
  });
  window.addEventListener('afterprint', function () { render(true); });

  function boot(d) {
    data = d;
    var sel = document.getElementById('site');
    sel.innerHTML = '<option value="all">' + R.esc(d.scope_note) + '</option>' + d.sites.map(function (s) { return '<option value="' + R.esc(s.key) + '">' + R.esc(s.name) + '</option>'; }).join('');
    document.getElementById('periods').innerHTML = d.periods.map(function (p) { return '<button type="button" data-period="' + R.esc(p.key) + '" aria-pressed="false" title="' + R.esc(p.long) + '">' + R.esc(p.short) + '</button>'; }).join('');
    document.getElementById('org').textContent = d.fingerprint;
    document.getElementById('asof').textContent = d.generated_at;
    if (d.more_sites) document.getElementById('more').textContent = d.more_sites + ' more site' + (d.more_sites === 1 ? '' : 's') + ' are in "' + d.scope_note + '" but not in the site list.';
    parseHash();
    render();
  }

  var embedded = document.getElementById('dash-data');
  if (embedded && embedded.textContent.trim()) { boot(JSON.parse(embedded.textContent)); return; }

  // ---------- MCP Apps: the same page hosted inline by an MCP client. The host sends the tool result
  // (whose structuredContent carries the dashboard data) after the ui/initialize handshake.
  if (window.parent === window) { main.innerHTML = '<p class="empty">No dashboard data in this file.</p>'; return; }
  var nextId = 1;
  function send(method, params, isRequest) { var msg = { jsonrpc: '2.0', method: method, params: params || {} }; if (isRequest) msg.id = nextId++; window.parent.postMessage(msg, '*'); return msg.id; }
  window.addEventListener('message', function (ev) {
    var m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id === 1 && m.result) {
      var ctxh = m.result.hostContext || {};
      if (ctxh.theme === 'dark' || ctxh.theme === 'light') setTheme(ctxh.theme, false);
      send('ui/notifications/initialized', {});
    } else if (m.method === 'ui/notifications/tool-result') {
      var sc = m.params && m.params.structuredContent;
      if (sc && sc.dashboard) { boot(sc.dashboard); send('ui/notifications/size-changed', { height: document.documentElement.scrollHeight }); }
      else main.innerHTML = '<p class="empty">The tool result carried no dashboard data. Open the saved HTML file instead.</p>';
    } else if (m.method === 'ui/notifications/host-context-changed' && m.params && m.params.theme) setTheme(m.params.theme, false);
  });
  send('ui/initialize', { appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, clientInfo: { name: 'safetyculture-mcp-dashboard', version: '1' }, protocolVersion: '2026-01-26' }, true);
})();
`;
