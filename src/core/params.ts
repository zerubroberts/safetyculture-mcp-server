import { z } from "zod";

/** Shared, consistently-described parameters so every tool speaks the same language. */
export const P = {
  period: (fallback = "last 30 days") =>
    z
      .string()
      .optional()
      .describe(`Time window, e.g. "last 30 days", "last quarter", "2026-Q3", "2026-07", "2026-07-01..2026-09-30", "ytd". Default: ${fallback}.`),
  limit: (def = 50, max = 500) => z.number().int().min(1).max(max).optional().describe(`Max records to return (default ${def}, max ${max}).`),
  siteId: z.string().optional().describe("Site ID (folder/location ID) to filter by. Use sc_list_sites to find it."),
  siteIds: z.array(z.string()).optional().describe("One or more site IDs to filter by."),
  templateId: z.string().optional().describe("Template ID (template_...). Use sc_list_templates to find it."),
  templateIds: z.array(z.string()).optional().describe("One or more template IDs."),
  inspectionId: z.string().describe("Inspection ID (audit_...)."),
  actionId: z.string().describe("Action ID (UUID)."),
  issueId: z.string().describe("Issue ID (UUID)."),
  userId: z.string().optional().describe("User ID (user_...)."),
  pageToken: z.string().optional().describe("Cursor from a previous call's next_page_token to fetch the next page."),
  fields: z.array(z.string()).optional().describe("Return only these fields of each record (keeps responses small)."),
};

/** Mitti IDs come in prefixed and bare forms; endpoints differ on which they accept. */
export const ids = {
  audit: (id: string) => (id.startsWith("audit_") ? id : `audit_${id.replaceAll("-", "")}`),
  template: (id: string) => (id.startsWith("template_") ? id : `template_${id.replaceAll("-", "")}`),
  user: (id: string) => (id.startsWith("user_") ? id : `user_${id.replaceAll("-", "")}`),
  /** Bare UUID with dashes, as used by the v1 services. */
  uuid: (id: string) => {
    const hex = id.replace(/^(audit|template|user|role|location|site|scheduleitem)_/, "").replaceAll("-", "");
    return /^[0-9a-f]{32}$/i.test(hex)
      ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      : id;
  },
};

/**
 * Links that open records in the Mitti web app (viewer must be signed in and have access).
 * Only formats verified against the live app are listed; anything else uses the API's own
 * deep-link / web-report endpoints instead of guessing.
 */
export const links = {
  inspection: (id: string) => `https://app.safetyculture.com/inspection/${ids.audit(id)}`,
  report: (id: string) => `https://app.safetyculture.com/report/audit/${ids.audit(id)}`,
  action: (id: string) => `https://app.safetyculture.com/actions/${id}`,
  issue: (id: string) => `https://app.safetyculture.com/issues/${id}`,
};

export function pick<T extends Record<string, unknown>>(row: T, fields?: string[]): Partial<T> {
  if (!fields?.length) return row;
  const out: Partial<T> = {};
  for (const f of fields) if (f in row) (out as Record<string, unknown>)[f] = row[f];
  return out;
}

export const countBy = <T>(rows: T[], key: (r: T) => string | undefined | null) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
};
