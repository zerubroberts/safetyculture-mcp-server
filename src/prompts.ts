import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Ready-made workflows. Clients show these as slash commands or a prompt picker
 * (for example "/mcp__safetyculture__weekly_safety_review" in Claude Code).
 */
const PROMPTS: Array<{
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodOptional<z.ZodString>>;
  text: (a: Record<string, string | undefined>) => string;
}> = [
  {
    name: "weekly_safety_review",
    title: "Weekly safety pulse",
    description: "Monday briefing: what got worse, what is overdue, what needs attention today.",
    args: { period: z.string().optional(), sites: z.string().optional() },
    text: (a) =>
      `Prepare my weekly safety pulse for ${a.sites ? `these sites: ${a.sites}` : "all sites"} for ${a.period ?? "the last 7 days"} compared with the period before.
Use sc_safety_pulse first. Then use sc_analyze_action_backlog for overdue actions grouped by site, and sc_analyze_schedule_compliance for missed inspections.
Structure: 1) three things that need me today, each with a link; 2) what improved and what got worse, with the numbers and record counts the tools reported; 3) overdue actions by owner.
Quote only numbers returned by the tools and state the data window. Do not create or change anything.`,
  },
  {
    name: "audit_readiness_pack",
    title: "Audit readiness evidence pack",
    description: "Builds the evidence an auditor or regulator asks for, for a site or region.",
    args: { scope: z.string().optional(), period: z.string().optional() },
    text: (a) =>
      `Build an audit evidence pack for ${a.scope ?? "the whole organisation"} covering ${a.period ?? "the last 12 months"}.
Include: scheduled inspection compliance (sc_analyze_schedule_compliance), open and overdue corrective actions with ageing (sc_analyze_action_backlog), incidents/issues and their closure (sc_list_issues), investigations where available, and expiring or expired credentials (sc_analyze_credential_radar).
Finish by exporting the supporting tables with sc_export_dataset and list the file paths. Read-only: do not change any records.`,
  },
  {
    name: "raise_actions_from_failed_items",
    title: "Find failed items and raise actions",
    description: "Searches failed answers across templates, then proposes corrective actions for review.",
    args: { topic: z.string().optional(), period: z.string().optional() },
    text: (a) =>
      `Find every failed inspection item about "${a.topic ?? "the topic I describe"}" in ${a.period ?? "the last 90 days"} using sc_analyze_failed_items, grouped by site.
Then propose one corrective action per site (title, assignee, due date, priority) as a table. Do NOT create anything until I approve the table. When I approve, create them with sc_create_action, one per row, with reason set to "raised from failed-item review".`,
  },
  {
    name: "investigate_change",
    title: "Explain a change",
    description: "Explains why a metric moved: real difference or noise, and what drove it.",
    args: { metric: z.string().optional(), scope: z.string().optional() },
    text: (a) =>
      `Investigate why ${a.metric ?? "the failed-item rate"} changed for ${a.scope ?? "the organisation"}. Use sc_analyze_compare_periods to test whether the change is statistically meaningful, then sc_analyze_failed_items and sc_analyze_site_league to find the drivers. Say plainly if the difference is likely noise or the sample is too small.`,
  },
  {
    name: "credential_check",
    title: "Credential and licence check",
    description: "Who has a licence, ticket or certificate expiring before a date.",
    args: { before: z.string().optional() },
    text: (a) =>
      `List everyone (staff and contractor companies) with a credential that is expired or expires ${a.before ? `before ${a.before}` : "in the next 30 days"}, using sc_analyze_credential_radar. Group by company, then person. Draft (do not send) a short reminder message per company.`,
  },
  {
    name: "template_hygiene",
    title: "Template hygiene audit",
    description: "Finds questions that never fail, are always N/A, or slow inspectors down.",
    args: { template: z.string().optional() },
    text: (a) =>
      `Audit the inspection template ${a.template ?? "I name"} with sc_analyze_template_quality over the last 6 months. Recommend which questions to cut, fix or keep, with the evidence counts for each. Read-only.`,
  },
];

export function registerPrompts(server: McpServer) {
  for (const p of PROMPTS) {
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.args }, (args: Record<string, string | undefined>) => ({
      messages: [{ role: "user", content: { type: "text", text: p.text(args) } }],
    }));
  }
}

export const PROMPT_NAMES = PROMPTS.map((p) => p.name);
