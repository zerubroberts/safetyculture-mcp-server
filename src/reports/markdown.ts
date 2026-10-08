import { cellText, deltaText, fmt, safeHref, type Block, type Cell, type Report } from "./model.js";

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
  if (c && typeof c === "object") {
    const href = safeHref(c.href);
    return href ? `[${mdEsc(c.text)}](${href})` : mdEsc(c.text);
  }
  return mdEsc(cellText(c));
}

function blockMd(b: Block): string {
  switch (b.kind) {
    case "kpis":
      return ["| Measure | Value | Change |", "|---|---:|---|", ...b.tiles.map((t) => `| ${mdEsc(t.label)} | ${mdEsc(fmt(t.value, t.unit ?? ""))} | ${mdEsc(deltaText(t))} |`)].join("\n");
    case "chart": {
      const c = b.chart;
      const head = c.kind === "pareto" ? `| ${mdEsc(c.xLabel)} | ${mdEsc(c.yLabel)} | Cumulative share |\n|---|---:|---:|` : `| ${mdEsc(c.xLabel)} | ${mdEsc(c.yLabel)} |\n|---|---:|`;
      const rows = c.points.map((p, i) => `| ${mdEsc(p.label)} | ${mdEsc(fmt(p.value, c.unit ?? ""))} |${c.kind === "pareto" ? ` ${mdEsc(fmt(c.cumulative?.[i] ?? null, "%"))} |` : ""}`);
      return `*${mdEsc(c.title)}*\n\n${head}\n${rows.join("\n")}`;
    }
    case "table":
      if (!b.rows.length) return `_${mdEsc(b.empty ?? "Nothing to show.")}_`;
      return [
        `| ${b.columns.map((c) => mdEsc(c.label)).join(" | ")} |`,
        `|${b.columns.map((c) => (c.align === "right" ? "---:" : "---")).join("|")}|`,
        ...b.rows.map((r) => `| ${r.map(cellMd).join(" | ")} |`),
      ].join("\n");
    case "text":
      return mdEsc(b.text);
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
