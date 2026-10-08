import type { FeedName } from "../cache/contract.js";
import { FEEDS } from "../cache/feeds.js";
import { ACTION_PRIORITY, ACTION_STATUS } from "../toolsets/actions.js";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "../toolsets/issues.js";
import { DAY, demoAnchor, generateDemoOrg, STATUS_NAME, type DemoOrg, type Row } from "./generate.js";

/**
 * A `fetch` that serves the synthetic demo organisation (src/demo/generate.ts) for every endpoint
 * the read tools, the analytics sync and the core write tools call. Pagination follows the real
 * shapes: Data Feeds return `metadata.next_page` (a relative path carrying the cursor) plus
 * `metadata.next_page_token`; REST lists return `next_page_token`. Writes mutate this instance's
 * in-memory copy only (a restart resets them). Unknown routes answer 404 naming the route, so a
 * gap in the demo is visible instead of silently empty.
 */

export const DEMO_BASE_URL = "https://demo.safetyculture-mcp.invalid";
const REPORT_URL = `${DEMO_BASE_URL}/report`;

type Q = URLSearchParams;
type Handler = (p: string[], q: Q, body: Row) => unknown;
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const notFound = (what: string): never => {
  throw new HttpError(404, `${what} was not found in the demo organisation.`);
};

const canon = (id: unknown) => String(id ?? "").replace(/^(audit|template|user|role|location)_/i, "").replaceAll("-", "").toLowerCase();
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown) => (typeof v === "string" && v ? Date.parse(v) : NaN);
const parts = (v: unknown) => {
  const d = new Date(ms(v));
  return Number.isFinite(d.getTime()) ? { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } : undefined;
};
const strip = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));
const values = (f: unknown): string[] => ((f as { value?: unknown[]; values?: unknown[] } | undefined)?.value ?? (f as { values?: unknown[] } | undefined)?.values ?? []).map(String);
const between = (v: unknown, range: unknown) => {
  const rg = range as { from?: unknown; to?: unknown } | undefined;
  const t = ms(v);
  const from = ms(typeof rg?.from === "object" ? (rg.from as Row).time : rg?.from);
  const to = ms(typeof rg?.to === "object" ? (rg.to as Row).time : rg?.to);
  return Number.isFinite(t) && !(t < from) && !(t >= to);
};

/** Offset paging for REST lists: `page_token` is the next offset as a string. */
function page<T>(rows: T[], token: unknown, size: unknown, max = 100) {
  const offset = Number(token ?? 0) || 0;
  const n = Math.max(1, Math.min(max, Number(size ?? 50) || 50));
  const next = offset + n < rows.length ? String(offset + n) : undefined;
  return { items: rows.slice(offset, offset + n), next_page_token: next ?? "", total: rows.length };
}

const KEY_BY_STATUS = Object.fromEntries(Object.entries(STATUS_NAME).map(([k, v]) => [v, k])) as Record<string, keyof typeof ACTION_STATUS>;
const STATUS_BY_ID = Object.fromEntries(Object.entries(ACTION_STATUS).map(([k, v]) => [v, k])) as Record<string, keyof typeof ACTION_STATUS>;
const PRIORITY_BY_ID = Object.fromEntries(Object.entries(ACTION_PRIORITY).map(([k, v]) => [v, k]));
const ISSUE_BY_ID = Object.fromEntries([...Object.entries(ISSUE_STATUS), ...Object.entries(ISSUE_PRIORITY)].map(([k, v]) => [v, k]));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function createDemoFetch(opts: { anchor?: number } = {}): typeof fetch {
  let db: DemoOrg | undefined;
  const org = () => (db ??= generateDemoOrg(opts.anchor ?? demoAnchor()));
  const routes = buildRoutes(org);
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Row = {};
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Row) : {};
    } catch {
      return reply(400, { message: "Request body is not valid JSON." });
    }
    const path = url.pathname;
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const hit = re.exec(path);
      if (!hit) continue;
      try {
        return reply(200, handler(hit.slice(1).map(decodeURIComponent), url.searchParams, body) ?? {});
      } catch (e) {
        if (e instanceof HttpError) return reply(e.status, { code: e.status, message: e.message });
        throw e;
      }
    }
    return reply(404, { code: 404, message: `Demo mode does not serve ${method} ${path}. This endpoint has no synthetic data yet.` });
  };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function buildRoutes(org: () => DemoOrg): Array<[string, RegExp, Handler]> {
  const out: Array<[string, RegExp, Handler]> = [];
  const on = (route: string, h: Handler) => {
    const [m, p] = route.split(" ") as [string, string];
    out.push([m, new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, "([^/]+)")}$`), h]);
  };
  const F = (n: FeedName) => org().feeds[n];
  const user = (id: unknown) => F("users").find((u) => same(u.id, id));
  const site = (id: unknown) => F("sites").find((s) => same(s.id, id));
  const tpl = (id: unknown) => org().templates.find((t) => same(t.id, id));
  const insp = (id: unknown) => F("inspections").find((i) => same(i.id, id)) ?? notFound(`Inspection ${id}`);
  const now = () => org().now;
  let itemsByAudit: Map<string, Row[]> | undefined;
  const itemsOf = (auditId: unknown) => {
    if (!itemsByAudit) {
      itemsByAudit = new Map();
      for (const it of F("inspection_items")) {
        const k = canon(it.audit_id);
        itemsByAudit.get(k)?.push(it) ?? itemsByAudit.set(k, [it]);
      }
    }
    return itemsByAudit.get(canon(auditId)) ?? [];
  };

  // ---- Data Feeds: every feed the cache mirrors, with the filters the tools and sync send ----
  const inspById = () => new Map(F("inspections").map((i) => [canon(i.id), i]));
  for (const def of Object.values(FEEDS)) {
    on(`GET ${def.path}`, (_p, q) => {
      let rows = F(def.name);
      const after = ms(q.get("modified_after") ?? q.get("triggered_after")), before = ms(q.get("modified_before"));
      const field = def.modifiedField ?? "modified_at";
      if (Number.isFinite(after)) rows = rows.filter((r) => ms(r[field]) > after);
      if (Number.isFinite(before)) rows = rows.filter((r) => ms(r[field]) < before);
      const templates = q.getAll("template");
      if (templates.length) rows = rows.filter((r) => templates.some((t) => same(r.template_id, t)));
      if (def.name === "inspections" || def.name === "inspection_items") {
        const map = def.name === "inspection_items" ? inspById() : undefined;
        const archived = q.get("archived") ?? "false", completed = q.get("completed") ?? "true";
        rows = rows.filter((r) => {
          const i = map ? map.get(canon(r.audit_id)) : r;
          if (!i) return false;
          return (archived === "both" || String(Boolean(i.archived)) === archived) && (completed === "both" || String(Boolean(i.date_completed)) === completed);
        });
      }
      if (def.name === "schedules" || def.name === "schedule_assignees") {
        const show = (s: unknown) => (s === "PAUSED" ? q.get("show_paused") : s === "FINISHED" ? q.get("show_finished") : q.get("show_active")) !== "false";
        const keep = new Set(F("schedules").filter((s) => show(s.status)).map((s) => s.id));
        rows = rows.filter((r) => keep.has(def.name === "schedules" ? r.id : r.schedule_id));
      }
      if (def.name === "schedule_occurrences") {
        const s = ms(q.get("start_date")), e = ms(q.get("end_date"));
        rows = rows.filter((r) => !(ms(r.due_time) < s) && !(ms(r.due_time) >= e));
      }
      if (def.name === "training_course_progress") {
        const c = q.get("courseId"), u = q.get("userId"), st = q.get("completionStatus");
        rows = rows.filter((r) => (!c || r.courseId === c) && (!u || same(r.userId, u)) && (st !== "COMPLETION_STATUS_COMPLETED" || r.completedAt) && (st !== "COMPLETION_STATUS_NON_COMPLETED" || !r.completedAt));
      }
      const limit = Math.max(1, Math.min(def.pageSize ?? 1000, Number(q.get("limit") ?? 20) || 20));
      const offset = Number(q.get("next_page_token") ?? q.get("offset") ?? 0) || 0;
      const data = rows.slice(offset, offset + limit).map(strip);
      const more = offset + limit < rows.length;
      const nq = new URLSearchParams(q);
      nq.delete("offset");
      nq.set("next_page_token", String(offset + limit));
      return { data, metadata: { next_page: more ? `${def.path}?${nq}` : null, next_page_token: more ? String(offset + limit) : null, remaining_records: Math.max(0, rows.length - offset - limit) } };
    });
  }

  // ---- Account ----
  on("GET /accounts/user/v1/user:WhoAmI", () => org().me);

  // ---- Inspections and templates ----
  const detailItem = (it: Row) => {
    const t = String(it.type);
    const answer = t === "question" || t === "list" ? { [t === "list" ? "list_items" : "question_item"]: { responses: it.response ? [{ id: it.response_id, value: it.response }] : [] } }
      : t === "text" ? { text_item: { text: it.response } } : t === "datetime" ? { datetime_item: { datetime: it.response } } : t === "signature" ? { signature_item: { name: it.response } } : {};
    return { item_id: it.item_id, type: t, label: it.label, parent_id: it.parent_id ?? undefined, flagged: it.is_failed_response === true, item_score: it.max_score ? { score: it.score, max_score: it.max_score, score_percentage: it.score_percentage } : undefined, ...answer, ...(it.comment ? { attachments: { note: it.comment, media: [{ id: `media-${it.item_id}` }] } } : {}) };
  };
  on("GET /inspections/v1/inspections/{id}/details", ([id]) => {
    const i = insp(id), s = site(i.site_id);
    return {
      inspection: {
        metadata: {
          inspection_id: i.id, inspection_name: i.name, created_time: i.created_at, last_modified_time: i.modified_at, last_modified_by: { id: i.author_id, name: i.author_name }, completed_time: i.date_completed ?? undefined,
          is_marked_as_complete: Boolean(i.date_completed), is_archived: i.archived, score: { combined_score: i.score, combined_max_score: i.max_score, combined_score_percentage: i.score_percentage },
          site: s ? { site_id: s.id, site_name: s.name } : undefined, owner: { id: i.owner_id, name: i.owner_name },
        },
        template: { template_id: i.template_id, template_name: i.template_name },
        items: itemsOf(i.id).map(detailItem),
      },
    };
  });
  on("GET /inspections/v1/inspections/{id}", ([id]) => {
    const i = insp(id);
    const media = itemsOf(i.id).filter((it) => it.comment).map((it) => ({ id: `media-${it.item_id}`, token: "demo-token", filename: `${String(it.label).slice(0, 30)}.jpg`, media_type: "MEDIA_TYPE_IMAGE" }));
    return { inspection: { id: i.id, title: i.name, duration: i.duration, media } };
  });
  on("GET /audits/{id}/web_report_link", ([id]) => ({ url: `${REPORT_URL}/${insp(id).id}` }));
  on("POST /audits/{id}/deep_link", ([id]) => ({ url: `${DEMO_BASE_URL}/app/inspection/${insp(id).id}` }));
  on("POST /inspection/v1/export", (_p, _q, b) => ({ status: "STATUS_DONE", url: `${REPORT_URL}/${insp((b.export_data as Row[] | undefined)?.[0]?.inspection_id).id}.pdf` }));
  on("GET /media/v1/download/{id}", ([id]) => ({ url: `${DEMO_BASE_URL}/media/${id}.jpg` }));
  on("POST /inspections/v1/inspections/{id}/archive", ([id]) => void Object.assign(insp(id), { archived: true, modified_at: iso(Date.now()) }));
  on("DELETE /inspections/v1/inspections/{id}/archive", ([id]) => void Object.assign(insp(id), { archived: false, modified_at: iso(Date.now()) }));
  on("DELETE /inspections/v1/inspections/{id}", ([id]) => {
    const i = insp(id);
    org().feeds.inspections = F("inspections").filter((x) => x !== i);
  });

  const ITEM_TYPE = (t: unknown) => `ITEM_TYPE_${String(t).toUpperCase()}`;
  on("GET /templates/search", (_p, q) => ({
    templates: F("templates").filter((t) => q.get("archived") === "both" || String(t.archived) === (q.get("archived") ?? "false")).map((t) => ({ template_id: t.id, name: t.name, modified_at: t.modified_at, created_at: t.created_at })),
  }));
  on("GET /templates/integration/v1/templates/{id}/definition", ([id]) => {
    const t = tpl(id) ?? notFound(`Template ${id}`), row = F("templates").find((x) => x.id === t.id)!;
    return {
      template: {
        template_identity: { template_id: t.id }, template_name: t.name, description: row.description, version: "1",
        items: t.items.map((it) => ({ item_id: it.item_id, type: ITEM_TYPE(it.type), label: it.label, parent_id: it.parent_id, ...(it.type === "question" || it.type === "list" ? { question_item: { response_set_id: t.responseSetId } } : {}) })),
        response_sets: { template_response_sets: [{ response_set_id: t.responseSetId, responses: t.responses }], global_response_sets: [] },
      },
    };
  });
  const setArchived = (id: string, archived: boolean) => void Object.assign(F("templates").find((t) => same(t.id, id)) ?? notFound(`Template ${id}`), { archived, modified_at: iso(Date.now()) });
  on("POST /templates/v1/templates/{id}/archive", ([id]) => setArchived(id!, true));
  on("DELETE /templates/v1/templates/{id}/archive", ([id]) => setArchived(id!, false));
  on("GET /response_sets/v2", (_p, q) => ({ response_sets: org().responseSets.slice(0, Number(q.get("limit") ?? 50)).map(({ responses: _r, ...s }) => s) }));
  on("GET /response_sets/{id}", ([id]) => org().responseSets.find((s) => s.responseset_id === id) ?? notFound(`Response set ${id}`));

  // ---- Actions ----
  const assigneesOf = (actionId: unknown) => F("action_assignees").filter((a) => a.action_id === actionId);
  const labelsOf = (a: Row) => [...String(a.action_label ?? "").matchAll(/"label_id":"([^"]+)"\|"label_name":"([^"]+)"/g)].map((m) => ({ label_id: m[1], label_name: m[2] }));
  const task = (a: Row) => {
    const s = site(a.site_id), c = user(a.creator_user_id);
    return {
      task_id: a.id, unique_id: a.unique_id, title: a.title, description: a.description, created_at: a.created_at, modified_at: a.modified_at, due_at: a.due_date ?? undefined, completed_at: a.completed_at,
      priority_id: ACTION_PRIORITY[String(a.priority).toLowerCase() as keyof typeof ACTION_PRIORITY], status_id: ACTION_STATUS[KEY_BY_STATUS[String(a.status)] ?? "to_do"],
      template_id: a.template_id, template_name: tpl(a.template_id)?.name, site: s ? { id: s.id, name: s.name } : undefined,
      inspection: a.audit_id ? { inspection_id: a.audit_id, inspection_name: a.audit_title } : undefined, inspection_item: a.audit_item_id ? { inspection_item_id: a.audit_item_id, inspection_item_name: a.audit_item_label } : undefined,
      creator: c ? { user_id: c.id, firstname: c.firstname, lastname: c.lastname } : undefined, action_label: labelsOf(a),
      collaborators: assigneesOf(a.id).map((x) => { const u = user(x.assignee_id); return { collaborator_id: x.assignee_id, collaborator_type: "USER", assigned_role: "ASSIGNEE", user: { user_id: x.assignee_id, firstname: u?.firstname, lastname: u?.lastname } }; }),
    };
  };
  const action = (id: unknown) => F("actions").find((a) => a.id === id) ?? notFound(`Action ${id}`);
  const sorter = (field: unknown, dir: unknown, map: Record<string, string>) => (a: Row, b: Row) => {
    const k = map[String(field)] ?? map.MODIFIED_AT!;
    const d = String(a[k] ?? "").localeCompare(String(b[k] ?? ""));
    return dir === "ASC" ? d : -d;
  };
  on("POST /tasks/v1/actions/list", (_p, _q, b) => {
    let rows = [...F("actions")];
    for (const f of (b.task_filters as Row[] | undefined) ?? []) {
      if (f.status_id) rows = rows.filter((a) => values(f.status_id).includes(ACTION_STATUS[KEY_BY_STATUS[String(a.status)]!]));
      if (f.priority_id) rows = rows.filter((a) => values(f.priority_id).includes(ACTION_PRIORITY[String(a.priority).toLowerCase() as keyof typeof ACTION_PRIORITY]));
      if (f.site_id) rows = rows.filter((a) => values(f.site_id).some((s) => same(s, a.site_id)));
      if (f.template_id) rows = rows.filter((a) => values(f.template_id).some((t) => same(t, a.template_id)));
      if (f.inspection_id) rows = rows.filter((a) => values(f.inspection_id).some((t) => same(t, a.audit_id)));
      if (f.label_id) rows = rows.filter((a) => labelsOf(a).some((l) => values(f.label_id).includes(String(l.label_id))));
      if (f.collaborators) rows = rows.filter((a) => assigneesOf(a.id).some((x) => (((f.collaborators as Row).value as Row[] | undefined) ?? []).some((c) => same(c.collaborator_id, x.assignee_id))));
      if (f.title) rows = rows.filter((a) => String(a.title).toLowerCase().includes(String((f.title as Row).term ?? "").toLowerCase()));
      if (f.created_at) rows = rows.filter((a) => between(a.created_at, f.created_at));
      if (f.due_at) rows = rows.filter((a) => between(a.due_date, f.due_at));
    }
    rows.sort(sorter(b.sort_field, b.sort_direction, { DATE_DUE: "due_date", CREATED_AT: "created_at", MODIFIED_AT: "modified_at", PRIORITY: "priority" }));
    const pg = page(rows, b.page_token, b.page_size);
    return { actions: pg.items.map((a) => ({ task: task(a) })), next_page_token: pg.next_page_token, total: pg.total };
  });
  on("GET /tasks/v1/actions/{id}", ([id]) => ({ action: { task: task(action(id)), custom_field_and_values: [], type: { name: "Corrective action" } }, read_only: false }));
  on("GET /tasks/v1/customer_configuration/action_labels", () => ({ labels: org().labels }));
  on("GET /tasks/v1/customer_configuration/task_types", () => ({ types: [{ id: "demo-type-corrective", name: "Corrective action" }] }));
  const touchAction = (a: Row, type: string, data: Row) => {
    a.modified_at = iso(Date.now());
    const me = org().me;
    F("action_timeline_items").push({ id: globalThis.crypto.randomUUID(), task_id: a.id, organisation_id: org().orgId, task_creator_id: a.creator_user_id, task_creator_name: a.creator_user_name, timestamp: a.modified_at, creator_id: me.user_id, creator_name: `${me.firstname} ${me.lastname}`, item_type: type, item_data: JSON.stringify(data) });
  };
  const setAssignees = (a: Row, list: Row[] | undefined) => {
    org().feeds.action_assignees = F("action_assignees").filter((x) => x.action_id !== a.id);
    for (const c of list ?? []) F("action_assignees").push({ id: globalThis.crypto.randomUUID(), action_id: a.id, assignee_id: c.collaborator_id, name: user(c.collaborator_id) ? `${user(c.collaborator_id)!.firstname} ${user(c.collaborator_id)!.lastname}` : String(c.collaborator_id), organisation_id: org().orgId, modified_at: iso(Date.now()), type: c.collaborator_type ?? "USER" });
  };
  on("POST /tasks/v1/actions", (_p, _q, b) => {
    if (!b.title) throw new HttpError(400, "title is required");
    const id = globalThis.crypto.randomUUID(), me = org().me, i = b.inspection_id ? insp(b.inspection_id) : undefined;
    const labels = org().labels.filter((l) => (b.label_ids as string[] | undefined)?.includes(String(l.label_id)));
    const a: Row = {
      id, title: b.title, description: b.description ?? "", site_id: b.site_id ?? i?.site_id ?? "", priority: cap(String(PRIORITY_BY_ID[String(b.priority_id)] ?? "none")), status: STATUS_NAME.to_do, due_date: b.due_at ?? null,
      creator_user_id: me.user_id, creator_user_name: `${me.firstname} ${me.lastname}`, created_at: iso(Date.now()), modified_at: iso(Date.now()), template_id: i?.template_id ?? "", organisation_id: org().orgId,
      audit_id: i?.id ?? "", audit_title: i?.name ?? "", audit_item_id: b.inspection_item_id ?? "", audit_item_label: itemsOf(i?.id).find((it) => it.item_id === b.inspection_item_id)?.label ?? "", completed_at: null,
      action_label: labels.map((l) => `{"label_id":"${l.label_id}"|"label_name":"${l.label_name}"}`).join("|"), unique_id: `ACT-${1000 + F("actions").length}`, type_id: "", type_name: "Corrective action",
    };
    F("actions").push(a);
    setAssignees(a, b.collaborators as Row[] | undefined);
    touchAction(a, "TASK_CREATED", { title: a.title });
    return { action_id: id };
  });
  const actionField: Record<string, (a: Row, b: Row) => void> = {
    title: (a, b) => void (a.title = b.title),
    description: (a, b) => void (a.description = b.description),
    priority: (a, b) => void (a.priority = cap(String(PRIORITY_BY_ID[String(b.priority_id)] ?? "none"))),
    due_at: (a, b) => void (a.due_date = b.due_at ?? null),
    site: (a, b) => void (a.site_id = (b.site_id as Row | undefined)?.value ?? ""),
    assignees: (a, b) => setAssignees(a, b.assignees as Row[]),
    status: (a, b) => {
      const key = STATUS_BY_ID[String(b.status_id)] ?? notFound(`Status ${b.status_id}`);
      a.status = STATUS_NAME[key];
      a.completed_at = key === "complete" || key === "cant_do" ? iso(Date.now()) : null;
      touchAction(a, "TASK_STATUS_UPDATED", { status_id: key, status_label: STATUS_NAME[key] });
    },
  };
  on("PUT /tasks/v1/actions/{id}/{field}", ([id, field], _q, b) => {
    const a = action(id);
    if (field === "label") a.action_label = org().labels.filter((l) => (b.label_ids as string[]).includes(String(l.label_id))).map((l) => `{"label_id":"${l.label_id}"|"label_name":"${l.label_name}"}`).join("|");
    else (actionField[field!] ?? notFound(`Action field ${field}`))(a, b);
    a.modified_at = iso(Date.now());
    return {};
  });
  on("POST /tasks/v1/actions/{id}/shared_link", ([id]) => ({ link: { url: `${DEMO_BASE_URL}/shared/action/${action(id).id}` } }));
  on("POST /tasks/v1/actions/delete", (_p, _q, b) => {
    const ids = new Set((b.ids as string[] | undefined) ?? []);
    org().feeds.actions = F("actions").filter((a) => !ids.has(String(a.id)));
  });

  // ---- Issues ----
  const issue = (id: unknown) => F("issues").find((i) => i.id === id) ?? notFound(`Issue ${id}`);
  const incident = (i: Row) => {
    const c = user(i.creator_id), s = site(i.site_id);
    const collaborators = ((i._assignees as string[] | undefined) ?? []).map((u) => ({ collaborator_id: u, collaborator_type: "USER", assigned_role: "ASSIGNEE", user: { user_id: u, firstname: user(u)?.firstname, lastname: user(u)?.lastname } }));
    return {
      task: {
        task_id: i.id, unique_id: i.unique_id, title: i.title, description: i.description, created_at: i.created_at, modified_at: i.modified_at, due_at: i.due_at, occurred_at: i.occurred_at, completed_at: i.completed_at,
        priority_id: ISSUE_PRIORITY[String(i.priority).toLowerCase() as keyof typeof ISSUE_PRIORITY], status_id: ISSUE_STATUS[String(i.status).toLowerCase() as keyof typeof ISSUE_STATUS],
        site: s ? { id: s.id, name: s.name } : undefined, creator: c ? { user_id: c.id, firstname: c.firstname, lastname: c.lastname } : undefined, collaborators,
      },
      category: { id: i.category_id, key: String(i.category_label).toLowerCase().replace(/ /g, "_"), label: i.category_label, description: i.category_description },
      inspections: [], media: [], location: { name: i.location_name },
    };
  };
  const issueFilter = (b: Row) => {
    let rows = [...F("issues")];
    for (const f of (b.filters as Row[] | undefined) ?? []) {
      if (f.status_id) rows = rows.filter((i) => values(f.status_id).some((v) => ISSUE_BY_ID[v] === String(i.status).toLowerCase()));
      if (f.priority_id) rows = rows.filter((i) => values(f.priority_id).some((v) => ISSUE_BY_ID[v] === String(i.priority).toLowerCase()));
      if (f.category_id) rows = rows.filter((i) => values(f.category_id).includes(String(i.category_id)));
      if (f.site_id) rows = rows.filter((i) => values(f.site_id).some((s) => same(s, i.site_id)));
      if (f.assignee_id) rows = rows.filter((i) => values(f.assignee_id).some((u) => ((i._assignees as string[] | undefined) ?? []).some((x) => same(x, u))));
      if (f.created_at) rows = rows.filter((i) => between(i.created_at, f.created_at));
      if (f.occurred_at) rows = rows.filter((i) => between(i.occurred_at, f.occurred_at));
    }
    return rows;
  };
  on("POST /tasks/v1/incidents/list", (_p, _q, b) => {
    const rows = issueFilter(b).sort(sorter(b.sort_field, b.sort_direction, { DATE_DUE: "due_at", CREATED_AT: "created_at", MODIFIED_AT: "modified_at", OCCURRED_AT: "occurred_at" }));
    const pg = page(rows, b.page_token, b.page_size);
    return { incidents: pg.items.map(incident), next_page_token: pg.next_page_token, total: pg.total };
  });
  on("POST /tasks/v1/incidents/list/count", (_p, _q, b) => ({ total: issueFilter(b).length }));
  on("GET /tasks/v1/incident/{id}", ([id]) => ({ incident: incident(issue(id)) }));
  on("GET /tasks/v1/incidents/{id}/questions_answers", ([id]) => ({ questions_answers: [{ question: { id: "q-what", text: "What happened?", type: "TEXT" }, is_answered: true, answer_set: [{ answer_text: { text: issue(id).description } }] }] }));
  on("GET /tasks/v1/customerconfiguration/categories", (_p, q) => {
    const pg = page(org().categories.map(strip), q.get("page_token"), q.get("page_size"));
    return { categories: pg.items, next_page_token: pg.next_page_token, total: pg.total };
  });
  on("POST /tasks/v1/timeline", (_p, _q, b) => {
    const rows = [...org().issueTimeline, ...F("action_timeline_items")].filter((t) => t.task_id === b.task_id);
    if (!rows.length) notFound(`Task ${b.task_id}`);
    return {
      timeline_items: rows.map((t) => {
        const data = JSON.parse(String(t.item_data || "{}")) as Row;
        const [firstname, ...rest] = String(t.creator_name).split(" ");
        return {
          item_id: t.id, item_type: t.item_type, timestamp: t.timestamp, creator: { firstname, lastname: rest.join(" ") },
          ...(t.item_type === "TASK_COMMENT_ADDED" ? { task_comment_added_data: { comment: data.comment } } : {}),
          ...(t.item_type === "TASK_STATUS_UPDATED" && data.status ? { task_status_updated_data: { status_id: ISSUE_STATUS[String(data.status).toLowerCase() as keyof typeof ISSUE_STATUS] } } : {}),
        };
      }),
    };
  });
  on("GET /tasks/v1/incidents/{id}/pdf_report", ([id]) => ({ url: `${REPORT_URL}/issue/${issue(id).id}.pdf` }));
  on("POST /tasks/v1/shared_link/{id}/web_report", ([id]) => ({ url: `${REPORT_URL}/issue/${issue(id).id}` }));
  const issueEvent = (i: Row, type: string, data: Row) => {
    i.modified_at = iso(Date.now());
    org().issueTimeline.push({ id: globalThis.crypto.randomUUID(), task_id: i.id, timestamp: i.modified_at, creator_id: org().me.user_id, creator_name: `${org().me.firstname} ${org().me.lastname}`, item_type: type, item_data: JSON.stringify(data) });
  };
  on("POST /tasks/v1/incidents/submit", (_p, _q, b) => {
    if (!b.title) throw new HttpError(400, "title is required");
    const cat = org().categories.find((c) => c.id === b.category_id), s = site(b.site_id), id = globalThis.crypto.randomUUID(), at = iso(Date.now());
    const i: Row = {
      id, title: b.title, description: b.description ?? "", creator_id: org().me.user_id, creator_user_name: `${org().me.firstname} ${org().me.lastname}`, created_at: at, due_at: null, priority: "None", status: "Open",
      template_id: "", inspection_id: "", inspection_name: "", site_id: s?.id ?? "", site_name: s?.name ?? "", location_name: s?.name ?? "", category_id: cat?.id ?? "", category_label: cat?.label ?? "",
      category_description: cat?.description ?? "", modified_at: at, completed_at: null, unique_id: `ISS-${100 + F("issues").length}`, occurred_at: b.occurred_at ?? at, organisation_id: org().orgId,
    };
    F("issues").push(i);
    issueEvent(i, "TASK_CREATED", {});
    return { incident_id: id, unique_id: i.unique_id };
  });
  const issueField: Record<string, (i: Row, b: Row) => void> = {
    title: (i, b) => void (i.title = b.title),
    description: (i, b) => void (i.description = b.description),
    priority: (i, b) => void (i.priority = cap(ISSUE_BY_ID[String(b.priority_id)] ?? "none")),
    due_at: (i, b) => void (i.due_at = b.due_at ?? null),
    occurred_at: (i, b) => void (i.occurred_at = b.occurred_at),
    site: (i, b) => { const s = site((b.site_id as Row | undefined)?.value); Object.assign(i, { site_id: s?.id ?? "", site_name: s?.name ?? "" }); },
    category: (i, b) => { const c = org().categories.find((x) => x.id === b.category_id) ?? notFound(`Category ${b.category_id}`); Object.assign(i, { category_id: c.id, category_label: c.label }); },
    asset: () => undefined,
    status: (i, b) => {
      const s = ISSUE_BY_ID[String(b.status_id)] ?? notFound(`Status ${b.status_id}`);
      Object.assign(i, { status: cap(s), completed_at: s === "resolved" ? iso(Date.now()) : null });
      issueEvent(i, "TASK_STATUS_UPDATED", { status: cap(s) });
    },
  };
  on("PUT /tasks/v1/incidents/{id}/{field}", ([id, field], _q, b) => {
    const i = issue(id);
    (issueField[field!] ?? notFound(`Issue field ${field}`))(i, b);
    i.modified_at = iso(Date.now());
  });
  on("POST /tasks/v1/incidents/{id}/collaborators/{op}", ([id, op], _q, b) => {
    const i = issue(id), ids = ((b.collaborators as Row[] | undefined) ?? []).map((c) => String(c.collaborator_id));
    const cur = new Set((i._assignees as string[] | undefined) ?? []);
    for (const u of ids) op === "add" ? cur.add(u) : cur.delete(u);
    i._assignees = [...cur];
  });
  on("POST /tasks/v1/timeline/comments", (_p, _q, b) => issueEvent(issue(b.task_id), "TASK_COMMENT_ADDED", { comment: b.comment }));
  on("POST /tasks/v1/incidents/delete", (_p, _q, b) => {
    const ids = new Set((b.ids as string[] | undefined) ?? []);
    org().feeds.issues = F("issues").filter((i) => !ids.has(String(i.id)));
  });

  // ---- Investigations (OSHA records: none in the demo organisation) ----
  const inv = (id: unknown) => org().investigations.find((v) => v.investigation_id === id) ?? notFound(`Investigation ${id}`);
  const invOut = (v: Row) => strip({ ...v, link_counts: { total_actions: v._action ? 1 : 0, open_actions: 0, closed_actions: v._action ? 1 : 0 }, fields: [] });
  on("GET /incidents/v1/investigations", (_p, q) => {
    const s = q.get("search")?.toLowerCase();
    const pg = page(org().investigations.filter((v) => !s || String(v.title).toLowerCase().includes(s)), q.get("page_token"), q.get("page_size"));
    return { results: pg.items.map(invOut), next_page_token: pg.next_page_token };
  });
  on("GET /incidents/v1/investigations/{id}", ([id]) => ({ investigation: invOut(inv(id)) }));
  on("GET /incidents/v1/investigations/{id}/{kind}/count", ([id, kind]) => ({ count: kind === "media" ? 0 : inv(id) && 1 }));
  on("GET /incidents/v1/investigations/{id}/{kind}", ([id, kind]) => {
    const v = inv(id);
    if (kind === "actions") return { actions: v._action ? [{ action: { task: task(action(v._action)) } }] : [] };
    if (kind === "issues") return { issues: [{ issue: { task: incident(issue(v._issue)).task } }] };
    if (kind === "inspections") { const i = insp(v._inspection); return { inspections: [{ inspection: { id: i.id, name: i.name, completed: Boolean(i.date_completed), archived: i.archived } }] }; }
    if (kind === "media") return { media: [] };
    return notFound(`Investigation link type ${kind}`);
  });
  on("GET /incidents/v1/osha/cases", () => ({ results: [], next_page_token: "" }));
  on("GET /incidents/v1/osha/establishments", () => ({ results: [], next_page_token: "" }));
  on("GET /incidents/v1/osha/cases/{id}", ([id]) => notFound(`OSHA case ${id}`));

  // ---- Sites (directory) and people ----
  const folder = (s: Row) => ({ id: s.id, name: s.name, meta_label: s.meta_label, created_at: F("inspections")[0]?.created_at, modified_at: s.modified_at ?? F("inspections")[0]?.created_at });
  const children = (id: unknown) => F("sites").filter((s) => s.parent_id && same(s.parent_id, id));
  const membersOf = (id: unknown, direct = false): string[] => {
    const own = F("site_members").filter((m) => same(m.site_id, id)).map((m) => String(m.member_id));
    return direct ? own : [...new Set([...own, ...children(id).flatMap((c) => membersOf(c.id))])];
  };
  const entry = (s: Row) => ({ folder: folder(s), ancestors: s.parent_id ? [folder(site(s.parent_id)!)] : [], members_count: membersOf(s.id).length, has_children: children(s.id).length > 0, children_count: children(s.id).length });
  on("POST /directory/v1/folders/search", (_p, _q, b) => {
    const text = String(b.query ?? "").toLowerCase();
    const rows = F("sites").filter((s) => !s.deleted && String(s.name).toLowerCase().includes(text));
    const pg = page(rows, b.page_token, b.limit, 500);
    return { folders: pg.items.map(entry), folder_count: pg.total, next_page_token: pg.next_page_token };
  });
  on("GET /directory/v1/folder/{id}", ([id]) => {
    const s = site(id) ?? notFound(`Site ${id}`);
    return { folder: folder(s), ancestors: entry(s).ancestors, all_children_count: children(s.id).length, member_count: membersOf(s.id).length };
  });
  on("GET /directory/v1/parent/{id}/folders", ([id]) => ({ folders: children(id).map((c) => ({ ...entry(c), depth: 1 })), next_page_token: "" }));
  on("GET /directory/v1/folder/{id}/users", ([id]) => ({ user_ids: membersOf((site(id) ?? notFound(`Site ${id}`)).id) }));
  on("GET /directory/v1/folder/{id}/users/associated", ([id]) => ({ user_ids: membersOf((site(id) ?? notFound(`Site ${id}`)).id, true) }));

  const userV1 = (u: Row) => ({ user_id: u.id, first_name: u.firstname, last_name: u.lastname, email: u.email, username: u.email, status: u.active ? "USER_ACTIVE_STATUS_ACTIVE" : "USER_ACTIVE_STATUS_DEACTIVATED", seat_type: `SUBSCRIPTION_SEAT_TYPE_${String(u.seat_type).toUpperCase()}`, timezone: "UTC", locale: "en-US", created_at: u.created_at, last_seen: u.last_seen_at });
  on("POST /users/v1/users/list", (_p, _q, b) => {
    const f = (b.filters ?? {}) as { user_ids?: string[]; statuses?: string[] };
    let rows = F("users");
    if (f.user_ids?.length) rows = rows.filter((u) => f.user_ids!.some((x) => same(x, u.id)));
    if (f.statuses?.length) rows = rows.filter((u) => f.statuses!.includes(u.active ? "USER_ACTIVE_STATUS_ACTIVE" : "USER_ACTIVE_STATUS_DEACTIVATED"));
    const pg = page(rows, b.page_token, b.page_size ?? 200, 200);
    return { users: pg.items.map(userV1), next_page_token: pg.next_page_token };
  });
  on("GET /groups", () => ({ groups: F("groups").map((g) => ({ id: g.id, name: g.name })) }));
  const group = (id: unknown) => F("groups").find((g) => g.id === id) ?? notFound(`Group ${id}`);
  on("GET /groups/{id}/users", ([id], q) => {
    const g = group(id), st = q.get("status");
    const rows = F("group_users").filter((m) => m.group_id === g.id).map((m) => user(m.user_id)!).filter((u) => !st || (st === "active") === Boolean(u.active));
    const offset = Number(q.get("offset") ?? 0);
    return { users: rows.slice(offset, offset + Number(q.get("limit") ?? 50)).map((u) => ({ ...userV1(u), firstname: u.firstname, lastname: u.lastname, status: u.active ? "active" : "inactive" })), total: rows.length };
  });
  on("POST /groups/{id}/users/v2", ([id], _q, b) => {
    const g = group(id), u = user(b.user_id) ?? notFound(`User ${b.user_id}`);
    if (!F("group_users").some((m) => m.group_id === g.id && m.user_id === u.id)) F("group_users").push({ user_id: u.id, group_id: g.id, organisation_id: org().orgId });
    return { users: F("group_users").filter((m) => m.group_id === g.id).map((m) => m.user_id) };
  });
  on("DELETE /groups/{id}/users/{user}", ([id, uid]) => {
    const before = F("group_users").length;
    org().feeds.group_users = F("group_users").filter((m) => !(m.group_id === id && same(m.user_id, uid)));
    return { ok: F("group_users").length < before };
  });
  on("POST /permissions/v1/permission_sets", (_p, _q, b) => ({ permission_sets: org().permissionSets.slice(Number(b.offset ?? 0), Number(b.offset ?? 0) + Number(b.limit ?? 50)) }));

  // ---- Schedules ----
  const schedule = (id: unknown) => F("schedules").find((s) => same(s.id, id)) ?? notFound(`Schedule ${id}`);
  on("GET /schedules/v1/schedule_items", () => ({ items: [], next_page_token: "", total: 0 }));
  on("GET /scheduling/v1/schedules/{id}", ([id]) => {
    const s = schedule(id), creator = user(s.created_by);
    return {
      id: s.id, title: s.title, status: `STATUS_${s.status}`, work_type: { inspection: { template_id: s.template_id, template_name: tpl(s.template_id)?.name } },
      recurrence: { dtstart_rrule: s.recurrence, duration: s.duration, use_site_timezone: false }, completion_rule: s.completion_rule,
      assignment: { users: { users: (s.assignees as string[]).map((u) => ({ id: u, name: `${user(u)?.firstname} ${user(u)?.lastname}` })) }, groups: { groups: [] } },
      target_summary: { target_type: "TARGET_TYPE_SITE", total_count: (s.site_ids as string[]).length }, creator: { id: creator?.id, name: `${creator?.firstname} ${creator?.lastname}` },
    };
  });
  for (const [op, status] of [["pause", "PAUSED"], ["resume", "ACTIVE"], ["end", "FINISHED"]] as const)
    on(`PATCH /scheduling/v1/schedules/{id}/${op}`, ([id]) => void Object.assign(schedule(id), { status, modified_at: iso(Date.now()) }));

  // ---- Training ----
  const course = (c: Row) => strip(c);
  on("GET /training/courses/v1", (_p, q) => {
    const ids = q.get("courseIds")?.split(","), s = q.get("searchTerm")?.toLowerCase();
    const rows = org().courses.filter((c) => (!ids || ids.includes(String(c.id))) && (!s || String(c.title).toLowerCase().includes(s)));
    const size = Number(q.get("pageSize") ?? 25), p = Number(q.get("page") ?? 1);
    return { items: rows.slice((p - 1) * size, p * size).map(course), totalCount: rows.length };
  });
  on("GET /training/courses/v1/{id}/lessons", ([id]) => ({ lessons: (org().courses.find((c) => c.id === id) ?? notFound(`Course ${id}`))._lessons }));
  on("GET /training/paths/v1", () => ({ items: org().paths, totalCount: org().paths.length }));
  on("GET /training/individualleaderboards/v1", () => ({ items: [{ id: "leaderboard-quarter", name: "This quarter's top learners", startDate: iso(now() - 90 * DAY), endDate: iso(now() + DAY), learnerAccess: true }], totalCount: 1 }));
  on("GET /training/individualleaderboards/v1/rankings", (_p, q) => {
    if (q.get("leaderboardId") !== "leaderboard-quarter") notFound(`Leaderboard ${q.get("leaderboardId")}`);
    const score = new Map<string, number>();
    for (const p of F("training_course_progress")) score.set(String(p.userId), (score.get(String(p.userId)) ?? 0) + Number(p.completedLessons) * 10 + Number(p.score));
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { leaderboardId: "leaderboard-quarter", leaderboardName: "This quarter's top learners", rankings: ranked.map(([u, s], i) => ({ rank: i + 1, participantId: u, participantName: `${user(u)?.firstname} ${user(u)?.lastname}`, totalScore: s, isNotAttempted: false })) };
  });
  on("PUT /training/courses/v1/{id}/assignments", (_p, _q, b) => ({ usersUpdated: ((b.users as unknown[] | undefined) ?? []).length, groupsUpdated: 0, sitesUpdated: 0 }));

  // ---- Heads Up ----
  const hu = (id: unknown) => org().headsUps.find((h) => h.id === id) ?? notFound(`Heads Up ${id}`);
  const huRow = (h: Row) => {
    const done = (h._done as boolean[]).filter(Boolean).length;
    return { id: h.id, title: h.title, published_at: h.published_at, author_id: h.author_id, author_name: h.author_name, viewed_count: Math.min((h._assigned as number[]).length, done + 4), acknowledgement_count: h.has_acknowledgement ? done : 0, has_acknowledgement: h.has_acknowledgement, assigned_users_count: (h._assigned as number[]).length, complete: done === (h._assigned as number[]).length, message_count: (h._comments as unknown[]).length };
  };
  on("POST /announcements/v1/announcement:ListHeadsUpManage", (_p, _q, b) => {
    const s = String(b.search_value ?? "").toLowerCase();
    const pg = page(org().headsUps.filter((h) => String(h.title).toLowerCase().includes(s)), b.page_token, b.page_size);
    return { heads_ups: pg.items.map(huRow), next_page_token: pg.next_page_token, total: pg.total };
  });
  on("GET /announcements/v1/announcement:GetHeadsUp", (_p, q) => ({ heads_up: { ...strip(hu(q.get("id"))), is_comments_disabled: false } }));
  on("POST /announcements/v1/announcement:GetHeadsUpCompletionCounts", (_p, _q, b) => {
    const r = huRow(hu(b.id));
    return { viewed_count: r.viewed_count, acknowledged_count: r.acknowledgement_count, message_count: r.message_count };
  });
  on("POST /announcements/v1/announcement:ListHeadsUpUsers", (_p, _q, b) => {
    const h = hu(b.heads_up_id), us = F("users");
    const rows = (h._assigned as number[]).map((i, k) => ({ id: us[i]!.id, email: us[i]!.email, first_name: us[i]!.firstname, last_name: us[i]!.lastname, status: (h._done as boolean[])[k], completion_details: { viewed: true, acknowledged: (h._done as boolean[])[k] } }));
    return { users: rows.slice(0, Number(b.page_size ?? 100)), total: rows.length };
  });
  on("POST /announcements/v1/announcement:GetHeadsUpMessages", (_p, _q, b) => {
    const h = hu((b.message_request as Row | undefined)?.reference_id), us = F("users");
    const messages = (h._comments as Array<[number, string]>).map(([u, text], k) => ({ id: `${h.id}-m${k}`, user_id: us[u]!.id, name: `${us[u]!.firstname} ${us[u]!.lastname}`, sent_at: iso(ms(h.published_at) + (k + 1) * 3_600_000), reply_count: 0, message: [{ text }] }));
    return { message_response: { messages, total: messages.length } };
  });

  // ---- Contractors and credentials ----
  const companyOut = (c: Row) => {
    const docs = org().companyDocs.filter((d) => d.company_id === c.company_id);
    const workers = new Set((c._users as number[]).map((i) => canon(F("users")[i]!.id)));
    const creds = F("credentials").filter((x) => workers.has(canon(x.subject_user_id)));
    const count = (rows: Row[], k: string, v: string) => rows.filter((x) => x[k] === v).length;
    return {
      company_id: c.company_id, company_type: { id: c.company_type_id, name: c.company_type_name },
      attributes: {
        name: c.company_name, status: c.status, contact_details: { email: c.email, phone_number: c.phone_number },
        compliance_statistics: { expired_document_count: count(docs, "doc_expiry_status", "EXPIRY_STATUS_EXPIRED"), expiring_soon_document_count: count(docs, "doc_expiry_status", "EXPIRY_STATUS_EXPIRING_SOON"), pending_approval_document_count: count(docs, "approval_status", "APPROVAL_STATUS_PENDING") },
        user_credential_compliance_statistics: { expired_user_credential_count: count(creds, "expiry_status", "EXPIRY_STATUS_EXPIRED"), expiring_soon_user_credential_count: count(creds, "expiry_status", "EXPIRY_STATUS_EXPIRING_SOON"), pending_approval_user_credential_count: count(creds, "approval_status", "PENDING"), total_user_credential_count: creds.length },
        linked_sites: (c._sites as string[]).map((id) => ({ site_id: id, site_name: site(id)?.name })), outstanding_document_request_count: 0,
      },
    };
  };
  const company = (id: unknown) => F("contractor_companies").find((c) => c.company_id === id) ?? notFound(`Company ${id}`);
  on("POST /companies/v1/companies", (_p, _q, b) => {
    const f = (b.filter ?? {}) as { search?: string; company_type_ids?: string[]; contractor_company_statuses?: string[] };
    const rows = F("contractor_companies").filter((c) => (!f.search || String(c.company_name).toLowerCase().includes(f.search.toLowerCase())) && (!f.company_type_ids?.length || f.company_type_ids.includes(String(c.company_type_id))) && (!f.contractor_company_statuses?.length || f.contractor_company_statuses.includes(String(c.status))));
    const pg = page(rows, b.page_token, b.page_size);
    return { contractor_company_list: pg.items.map(companyOut), total_count: pg.total, next_page_token: pg.next_page_token };
  });
  on("GET /companies/v1/company", (_p, q) => ({ contractor_company: companyOut(company(q.get("company_id"))) }));
  on("POST /companies/v1/users", (_p, _q, b) => ({ company_user_metadata_list: (company(b.company_id)._users as number[]).map((i, k) => ({ user_doc: { id: F("users")[i]!.id, first_name: F("users")[i]!.firstname, last_name: F("users")[i]!.lastname }, role: k === 0 ? "CONTRACTOR_COMPANY_ROLE_ADMIN" : "CONTRACTOR_COMPANY_ROLE_MEMBER" })), next_page_token: "" }));
  on("POST /companies/v1/documents", (_p, _q, b) => {
    const f = (b.filter ?? {}) as { doc_expiry_statuses?: string[]; approval_statuses?: string[] };
    const rows = org().companyDocs.filter((d) => d.company_id === company(b.company_id).company_id && (!f.doc_expiry_statuses?.length || f.doc_expiry_statuses.includes(String(d.doc_expiry_status))) && (!f.approval_statuses?.length || f.approval_statuses.includes(String(d.approval_status))));
    const pg = page(rows, b.page_token, b.page_size);
    return { company_document_list: pg.items.map((d) => ({ ...strip(d), expiration_date: parts(iso(d._expiry as number)), company_document_type: { id: `doctype-${String(d._type).length}`, name: d._type } })), total_count: pg.total, next_page_token: pg.next_page_token };
  });
  on("POST /credentials/v1/credential-types", () => ({ types_list: F("credential_types").map((t) => ({ id: t.document_type_id, name: t.document_type_name, type_category: "TYPE_CATEGORY_CUSTOM", stats: { mapping_count: F("credentials").filter((c) => c.document_type_id === t.document_type_id).length } })), next_page_token: "" }));
  on("POST /credentials/v1/credentials", (_p, _q, b) => {
    const f = ((b.document_version_filters as Row[] | undefined) ?? [])[0] ?? {};
    const rows = F("credentials")
      .filter((c) => !c.deleted && (!f.user_id || values(f.user_id).some((u) => same(u, c.subject_user_id))) && (!f.document_type_id || values(f.document_type_id).includes(String(c.document_type_id))) && (!f.expiry_status || values(f.expiry_status).includes(String(c.expiry_status))))
      .sort((a, b) => String(a.expiry_date || "9999").localeCompare(String(b.expiry_date || "9999")));
    const pg = page(rows, b.page_token, b.page_size);
    return {
      latest_document_versions: pg.items.map((c) => ({ document_id: c.document_id, subject_user: { id: c.subject_user_id, first_name: c.subject_user_first_name, last_name: c.subject_user_last_name }, document_type: { id: c.document_type_id, name: c.document_type_name }, attributes: { expiry_period_end_date: c.expiry_date ? parts(`${c.expiry_date}T00:00:00Z`) : undefined }, metadata: { expiry_status: c.expiry_status || undefined } })),
      total_count: pg.total, next_page_token: pg.next_page_token,
    };
  });

  // ---- Assets and maintenance ----
  const assetOut = (a: Row) => {
    const t = org().assetTypes[a._type as number]!, s = F("sites")[3 + (a._site as number)]!;
    return { id: a.id, code: a.code, type: { type_id: t.id, name: t.name }, site: { id: s.id, name: s.name }, state: a.state, inspected_at: a.inspected_at, modified_at: a.modified_at, media: [], statuses: [{ name: a.state === "ASSET_STATE_ACTIVE" ? "In service" : "Retired" }], fields: ["Serial number", "Make", "Model"].map((name, i) => ({ field_id: `field-${i + 1}`, name, string_value: (a._fields as string[])[i] })) };
  };
  const asset = (id: unknown) => org().assets.find((a) => a.id === id) ?? notFound(`Asset ${id}`);
  on("POST /assets/v1/assets/list", (_p, _q, b) => {
    const text = String(b.search ?? "").toLowerCase();
    let rows = org().assets.map(assetOut).filter((a) => !text || JSON.stringify(a).toLowerCase().includes(text));
    for (const f of (b.asset_filters as Row[] | undefined) ?? []) rows = rows.filter((a) => (!f.type_id || a.type.type_id === f.type_id) && (!f.site_id || same(a.site.id, f.site_id)) && (!f.state || a.state === f.state));
    const pg = page(rows, b.page_token, b.page_size);
    return { assets: pg.items, next_page_token: pg.next_page_token };
  });
  on("GET /assets/v1/assets:GetAssetByCode", (_p, q) => ({ asset: assetOut(org().assets.find((a) => a.code === q.get("code")) ?? notFound(`Asset code ${q.get("code")}`)) }));
  on("POST /assets/v1/assets:LookupAssetsByField", (_p, _q, b) => ({ assets: org().assets.map(assetOut).filter((a) => a.fields.some((f) => f.name.toLowerCase() === String(b.field_name).toLowerCase() && f.string_value === b.string_value)), next_page_token: "" }));
  on("GET /assets/v1/assets/{id}", ([id]) => ({ asset: assetOut(asset(id)) }));
  on("PATCH /assets/v1/assets/{id}/archive", ([id]) => { const a = asset(id); a.state = "ASSET_STATE_ARCHIVED"; return { id: a.id }; });
  on("POST /assets/v1/types/list", (_p, _q, b) => ({ type_list: org().assetTypes.filter((t) => !b.search || String(t.name).toLowerCase().includes(String(b.search).toLowerCase())), next_page_token: "" }));
  on("POST /assets/v1/fields/list", () => ({ result: ["Serial number", "Make", "Model"].map((name, i) => ({ id: `field-${i + 1}`, name, field_type: "FIELD_TYPE_DEFAULT", value_type: "FIELD_VALUE_TYPE_STRING" })) }));
  const programOf = (a: Row) => org().programs.find((p) => p._type === a._type);
  on("POST /assets/v1/maintenance/program/details", () => ({ program_details: org().programs.map((p) => ({ program: { id: p.id, name: p.name, description: p.description }, assets_count: org().assets.filter((a) => a._type === p._type).length, plans_count: 1 })), next_page_token: "" }));
  on("POST /assets/v1/maintenance/assets/details", (_p, _q, b) => ({
    details: ((b.filter as Row | undefined)?.asset_ids as string[] | undefined ?? []).map((id) => asset(id)).filter(programOf).map((a) => {
      const p = programOf(a)!, last = ms(a.inspected_at);
      return { program_summary: { id: p.id, name: p.name }, plan_summary: p.plan, service_status: a._service, last_service_timestamp: iso(last), next_service: { timestamp: iso(last + 90 * DAY) }, open_action_count: a._service === "ASSET_SERVICE_STATUS_OVERDUE" ? 1 : 0 };
    }),
  }));
  on("POST /assets/v1/maintenance/asset/{id}/service-history", ([id]) => {
    const a = asset(id);
    return { history: [0, 1, 2].map((k) => ({ service_date: iso(ms(a.inspected_at) - k * 90 * DAY), service_value: { unit_value: { value: 90, unit: "days" } }, user: { name: "Delta Mechanical technician" } })) };
  });
  on("POST /assets/v1/maintenance/assets/status-counts", (_p, _q, b) => {
    const f = (b.filter ?? {}) as { site_ids?: string[]; program_ids?: string[] };
    const rows = org().assets.filter((a) => programOf(a) && (!f.site_ids?.length || f.site_ids.some((s) => same(s, F("sites")[3 + (a._site as number)]!.id))) && (!f.program_ids?.length || f.program_ids.includes(String(programOf(a)!.id))));
    const n = (s: string) => rows.filter((a) => a._service === `ASSET_SERVICE_STATUS_${s}`).length;
    return { scheduled_count: n("SCHEDULED"), due_soon_count: n("DUE_SOON"), overdue_count: n("OVERDUE"), data_missing_count: 0 };
  });

  // ---- Documents, sensors, webhooks ----
  const docs = () => org().documents;
  const fileOut = (f: Row) => ({ ...strip(f), ancestors: [{ folder_id: docs().folders[f._folder as number]!.folder_id, name: docs().folders[f._folder as number]!.name }] });
  on("POST /documents/v1/search", (_p, _q, b) => {
    const t = String(b.search_term ?? "").toLowerCase(), hit = (r: Row) => String(r.name).toLowerCase().includes(t);
    const folders = b.archived ? [] : docs().folders.filter(hit), files = b.archived ? [] : docs().files.filter(hit).map(fileOut);
    return { folders, files, total: folders.length + files.length, next_page_token: "" };
  });
  on("POST /documents/v1/children", (_p, _q, b) => {
    const k = docs().folders.findIndex((f) => f.folder_id === b.parent_id);
    if (k < 0) notFound(`Folder ${b.parent_id}`);
    const files = b.archived ? [] : docs().files.filter((f) => f._folder === k).map(fileOut);
    return { folders: [], files, total: files.length, next_page_token: "" };
  });
  on("POST /sensors/v1/sensors/list", () => ({ sensors: org().sensors, next_page_token: "" }));
  on("GET /sensors/v1/sensors/{source}/{id}/latest-readings", ([source, id]) => {
    const k = org().sensors.findIndex((s) => s.source_name === source && s.source_id === id);
    if (k < 0) notFound(`Sensor ${source}/${id}`);
    const at = iso(Date.now() - 5 * 60_000);
    return { readings: [{ timestamp: at, name: "temperature", type: "TEMPERATURE", value: (k === 2 ? 19.5 : 2.8 + k * 0.7).toFixed(1), unit: "C" }, { timestamp: at, name: "humidity", type: "HUMIDITY", value: String(55 + k * 4), unit: "%" }] };
  });
  on("GET /webhooks/v1/webhooks", () => ({ webhook: org().webhooks }));
  on("POST /webhooks/v1/webhooks", (_p, _q, b) => {
    const w = { webhook_id: globalThis.crypto.randomUUID(), trigger_events: b.trigger_events, url: b.url, user_id: org().me.user_id, organisation_id: org().orgId, enabled: true, created_at: iso(Date.now()), updated_at: iso(Date.now()) };
    org().webhooks.push(w);
    return { webhook: w };
  });
  on("DELETE /webhooks/v1/webhooks/{id}", ([id]) => {
    if (!org().webhooks.some((w) => w.webhook_id === id)) notFound(`Webhook ${id}`);
    org().webhooks = org().webhooks.filter((w) => w.webhook_id !== id);
  });
  return out;
}

/**
 * Routes requests for the demo host to the demo fetch and leaves every other host untouched.
 * Used by the CLI (doctor), which builds its own API client.
 */
export function installDemoFetch(): void {
  const real = globalThis.fetch.bind(globalThis);
  const demo = createDemoFetch();
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return href.startsWith(`${DEMO_BASE_URL}/`) ? demo(input, init) : real(input, init);
  }) as typeof fetch;
}
