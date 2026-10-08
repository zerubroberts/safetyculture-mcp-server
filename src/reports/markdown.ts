import { cellText, deltaText, edgePartial, fmt, partialNote, safeHref, type Block, type Cell, type Report } from "./model.js";

/** Markdown twin of the HTML report. User text is escaped so it cannot inject HTML or table syntax. */

export function mdEsc(s: unknown): string {
  return String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]|#])/g, "\\$1");
}

function cellMd(c: Cell): string {
  if (c && typeof c === "object" && "text" in c) {
    const href = safeHref(c.href);
    return href ? `[${mdEsc(c.text)}](${href})` : mdEsc(c.text);
  }
  return mdEsc(cellText(c));
}

const table = (head: string[], align: Array<"l" | "r">, rows: string[][]) =>
  [`| ${head.map(mdEsc).join(" | ")} |`, `|${align.map((a) => (a === "r" ? "---:" : "---")).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** Exhibit heading in the Markdown twin: the action title, then the measure. */
const exhibitHead = (title: string, subtitle?: string) => `*${mdEsc(title)}*${subtitle ? `\n\n${mdEsc(subtitle)}` : ""}`;
const withNote = (body: string, note?: string) => (note ? `${body}\n\n_${mdEsc(note)}_` : body);

function blockMd(b: Block): string {
  switch (b.kind) {
    case "kpis":
      return ["| Measure | Value | Change |", "|---|---:|---|", ...b.tiles.map((t) => `| ${mdEsc(t.label)} | ${mdEsc(fmt(t.value, t.unit ?? ""))} | ${mdEsc(deltaText(t))} |`)].join("\n");
    case "chart": {
      const c = b.chart;
      const two = c.kind === "line" && c.series2;
      const head =
        c.kind === "pareto"
          ? `| ${mdEsc(c.xLabel)} | ${mdEsc(c.yLabel)} | Cumulative share |\n|---|---:|---:|`
          : two
            ? `| ${mdEsc(c.xLabel)} | ${mdEsc(c.seriesLabel ?? c.yLabel)} | ${mdEsc(c.series2!.label)} |\n|---|---:|---:|`
            : `| ${mdEsc(c.xLabel)} | ${mdEsc(c.yLabel)} |\n|---|---:|`;
      const rows = c.points.map(
        (p, i) =>
          `| ${mdEsc(p.partial ? `${p.label} †` : p.label)} | ${mdEsc(fmt(p.value, c.unit ?? ""))} |${c.kind === "pareto" ? ` ${mdEsc(fmt(c.cumulative?.[i] ?? null, "%"))} |` : ""}${two ? ` ${mdEsc(fmt(c.series2!.values[i] ?? null, c.unit ?? ""))} |` : ""}`,
      );
      const notes = [
        ...(c.reference ? [`${c.reference.label}: ${fmt(c.reference.value, c.unit ?? "")}`] : []),
        ...(c.markers ?? []).map((m) => `Marker at ${c.points[m.index]?.label ?? m.index}: ${m.label}`),
      ];
      const partial = edgePartial(c.points) ? `\n\n_${mdEsc(partialNote(c.xLabel))}_` : "";
      return `${exhibitHead(c.title, c.subtitle)}\n\n${head}\n${rows.join("\n")}${notes.length ? `\n\n${notes.map((n) => `- ${mdEsc(n)}`).join("\n")}` : ""}${partial}`;
    }
    case "bars":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(
          ["", b.valueLabel, ...(b.rows.some((r) => r.note) ? ["Context"] : [])],
          ["l", "r", "l"],
          b.rows.map((r) => [mdEsc(r.label), mdEsc(fmt(r.value, b.unit ?? "")), ...(b.rows.some((x) => x.note) ? [mdEsc(r.note ?? "")] : [])]),
        )}`,
        b.note,
      );
    case "stacked":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(
          ["", ...b.segments.map((s) => s.label), "Total"],
          ["l", ...b.segments.map(() => "r" as const), "r"],
          b.rows.map((r) => [mdEsc(r.label), ...b.segments.map((_, k) => mdEsc(fmt(r.values[k] ?? null))), mdEsc(fmt(r.values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0)))]),
        )}`,
        b.note,
      );
    case "dumbbell":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(["", b.fromLabel, b.toLabel], ["l", "r", "r"], b.rows.map((r) => [mdEsc(r.label), mdEsc(fmt(r.from, b.unit ?? "")), mdEsc(fmt(r.to, b.unit ?? ""))]))}`,
        b.note,
      );
    case "heatmap":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(
          [b.rowHeader, ...b.columns.map((c, i) => (b.partial?.[i] ? `${c} †` : c))],
          ["l", ...b.columns.map(() => "r" as const)],
          b.rows.map((r) => [mdEsc(r.label), ...r.values.map((v) => mdEsc(fmt(v, b.unit ?? "")))]),
        )}`,
        [b.note, b.partial?.some(Boolean) ? partialNote("week") : ""].filter(Boolean).join(" ") || undefined,
      );
    case "multiples":
      if (!b.panels.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(
          ["", ...b.xLabels.map((c, i) => (b.partial?.[i] ? `${c} †` : c))],
          ["l", ...b.xLabels.map(() => "r" as const)],
          b.panels.map((p) => [mdEsc(p.label), ...p.values.map((v) => mdEsc(fmt(v, b.unit ?? "")))]),
        )}`,
        b.note,
      );
    case "bullets":
      return withNote(
        `${exhibitHead(b.title, b.subtitle)}\n\n${table(
          ["Measure", "This period", b.compareLabel],
          ["l", "r", "r"],
          b.rows.map((r) => [mdEsc(r.label), mdEsc(`${fmt(r.value, r.unit ?? "")}${r.note ? ` (${r.note})` : ""}`), mdEsc(fmt(r.compare, r.unit ?? ""))]),
        )}`,
        b.note,
      );
    case "table":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return [
        `| ${b.columns.map((c) => mdEsc(c.label)).join(" | ")} |`,
        `|${b.columns.map((c) => (c.align === "right" ? "---:" : "---")).join("|")}|`,
        ...b.rows.map((r) => `| ${r.map(cellMd).join(" | ")} |`),
      ].join("\n");
    case "text":
      return mdEsc(b.text);
    case "unavailable":
      return `> **Not available.** ${mdEsc(b.text)}`;
    case "list":
      if (!b.items.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return b.items.map((i) => `- ${mdEsc(i.text)}${safeHref(i.href) ? ` ([open](${safeHref(i.href)}))` : ""}`).join("\n");
    case "notes":
      if (!b.items.length) return "";
      return `${b.title ? `**${mdEsc(b.title)}**\n\n` : ""}${b.items.map((n) => `- ${mdEsc(n)}`).join("\n")}`;
  }
}

export function renderMarkdown(r: Report): string {
  const out = [
    `# ${mdEsc(r.title)}`,
    "",
    ...(r.subtitle ? [mdEsc(r.subtitle), ""] : []),
    `Organisation **${mdEsc(r.fingerprint)}** · Period **${mdEsc(r.periodLabel)}** · Generated **${mdEsc(r.generatedAt)}** · Data from Mitti via safetyculture-mcp`,
    "",
  ];
  if (r.summary?.length) out.push("## Executive summary", "", r.summary.map(mdEsc).join(" "), "");
  for (const s of r.sections) {
    out.push(`## ${mdEsc(s.title)}`, "");
    if (s.intro) out.push(mdEsc(s.intro), "");
    for (const b of s.blocks) {
      const md = blockMd(b);
      if (md) out.push(md, "");
    }
  }
  out.push("---", "", "Computed locally from cached Mitti Data Feeds by safetyculture-mcp. Organisation shown as a fingerprint, not a name.", "");
  return out.join("\n");
}
