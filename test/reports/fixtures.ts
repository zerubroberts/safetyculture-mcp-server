// Synthetic row builders for the extended analytics and report tests. No real data.

export const NOW = new Date("2026-10-08T12:00:00.000Z");
export const ORG = "role_demo-org-0001";

export function insp(
  id: string,
  o: { tpl: string; site?: string; owner?: string; ownerName?: string; completed?: string | null; duration?: number; score?: number; max?: number; archived?: boolean; tplName?: string },
): Record<string, unknown> {
  return {
    id,
    name: `Inspection ${id}`,
    archived: o.archived ?? false,
    organisation_id: ORG,
    owner_id: o.owner ?? "user_demo1",
    owner_name: o.ownerName ?? "Alex Demo",
    score: o.score ?? 0,
    max_score: o.max ?? (o.score !== undefined ? 100 : 0),
    score_percentage: o.score ?? 0,
    duration: o.duration ?? 0,
    site_id: o.site ?? "site-1",
    template_id: o.tpl,
    template_name: o.tplName ?? `Template ${o.tpl}`,
    date_started: o.completed ?? null,
    date_completed: o.completed === undefined ? "2026-09-15T10:00:00.000Z" : o.completed,
  };
}

let seq = 0;
export function item(
  audit: string,
  label: string,
  o: { tpl?: string; type?: string; response?: string; failed?: boolean; inactive?: boolean; itemId?: string; parent?: string | null; prime?: string | null; category?: string } = {},
): Record<string, unknown> {
  const itemId = o.itemId ?? `item-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return {
    id: `${audit}_${itemId}_${seq++}`,
    item_id: itemId,
    audit_id: audit,
    template_id: o.tpl ?? "template_t1",
    parent_id: o.parent ?? null,
    organisation_id: ORG,
    type: o.type ?? "question",
    category: o.category ?? "General",
    label,
    response: o.response ?? "Yes",
    is_failed_response: o.failed ?? false,
    inactive: o.inactive ?? false,
    primeelement_id: o.prime ?? null,
  };
}

export function action(id: string, o: { status?: string; priority?: string; site?: string; created?: string; due?: string | null; completed?: string | null; title?: string; tpl?: string }) {
  return {
    id,
    title: o.title ?? `Action ${id}`,
    site_id: o.site ?? "site-1",
    priority: o.priority ?? "MEDIUM",
    status: o.status ?? "TODO",
    due_date: o.due ?? null,
    created_at: o.created ?? "2026-09-01T00:00:00.000Z",
    modified_at: o.completed ?? o.created ?? "2026-09-01T00:00:00.000Z",
    completed_at: o.completed ?? null,
    template_id: o.tpl ?? "template_t1",
    organisation_id: ORG,
    unique_id: `A-${id}`,
  };
}

export function issue(id: string, o: { category?: string | null; site?: string | null; siteName?: string; created: string; priority?: string; title?: string }) {
  return {
    id,
    title: o.title ?? `Issue ${id}`,
    created_at: o.created,
    priority: o.priority ?? "Low",
    status: "Open",
    site_id: o.site === undefined ? "site-1" : o.site,
    site_name: o.siteName ?? (o.site === null ? null : o.site === undefined ? "Demo Depot" : `Site ${o.site}`),
    category_id: o.category ? `cat-${o.category}` : null,
    category_label: o.category ?? null,
    template_id: null,
    organisation_id: ORG,
  };
}

export function timeline(taskId: string, type: string, ts: string, data: unknown = {}) {
  return { id: `${taskId}-${type}-${ts}`, task_id: taskId, organisation_id: ORG, timestamp: ts, item_type: type, item_data: typeof data === "string" ? data : JSON.stringify(data) };
}

export const site = (id: string, name: string) => ({ id, name, organisation_id: ORG, deleted: false });
