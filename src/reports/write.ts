import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHtml } from "./html.js";
import { renderMarkdown } from "./markdown.js";
import type { Report } from "./model.js";

/** Writes the HTML report and its Markdown twin to <exportDir>/reports/. Returns both paths. */
export async function writeReport(report: Report, exportDir: string, slug: string, now: Date): Promise<{ html: string; markdown: string }> {
  const dir = join(exportDir, "reports");
  await mkdir(dir, { recursive: true });
  const base = `${slug}-${now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}Z`;
  const html = join(dir, `${base}.html`);
  const markdown = join(dir, `${base}.md`);
  await writeFile(html, renderHtml(report), { encoding: "utf8", mode: 0o600 });
  await writeFile(markdown, renderMarkdown(report), { encoding: "utf8", mode: 0o600 });
  return { html, markdown };
}
