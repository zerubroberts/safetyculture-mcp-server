import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Writes the dashboard to <exportDir>/dashboards/safety-dashboard-<UTC timestamp>.html (owner-only file mode). */
export async function writeDashboard(html: string, exportDir: string, now: Date): Promise<string> {
  const dir = join(exportDir, "dashboards");
  await mkdir(dir, { recursive: true });
  const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}Z`;
  const path = join(dir, `safety-dashboard-${stamp}.html`);
  await writeFile(path, html, { encoding: "utf8", mode: 0o600 });
  return path;
}
