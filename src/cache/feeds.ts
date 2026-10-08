import type { FeedDef, FeedName } from "./contract.js";

/**
 * Every Data Feed the local cache mirrors. Paths, query parameters and field names were checked
 * against the API reference (node scripts/api-ref.mjs <slug>, slug in each comment) and the live
 * shapes in docs/api-shapes.md.
 *
 * Page sizes: the feeds take `limit`. Where the reference states a maximum it is used
 * (scheduling 1-1000, activity log capped at 250). Where it states none, the classic /feed/*
 * endpoints use 500 and the newer feedservice endpoints 100; sync falls back to 100 if the API
 * answers 400 to a larger page.
 *
 * Feeds without `incremental` are re-pulled in full on every sync (the reference documents no
 * modified-after filter for them) and the cached table is replaced atomically when the pull
 * completes, so deletions upstream disappear locally too.
 */

/** Joins key parts; returns "" (row skipped) when any part is missing. */
const composite =
  (...fields: string[]) =>
  (row: Record<string, unknown>): string => {
    const parts = fields.map((f) => row[f]);
    return parts.every((p) => p !== undefined && p !== null && p !== "") ? parts.map(String).join(":") : "";
  };

const field = (name: string) => (row: Record<string, unknown>) => {
  const v = row[name];
  return v === undefined || v === null ? "" : String(v);
};

/** Uses the row's own `id` when the API sends one, otherwise the composite (shape differs by feed version). */
const idOr = (...fields: string[]) => {
  const fallback = composite(...fields);
  return (row: Record<string, unknown>) => field("id")(row) || fallback(row);
};

const def = (name: FeedName, d: Omit<FeedDef, "name">): FeedDef => ({ name, ...d });

export const FEEDS: Record<FeedName, FeedDef> = {
  // thepubservice_feedinspections
  inspections: def("inspections", {
    path: "/feed/inspections",
    key: field("id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 500,
    query: { archived: "both", completed: "both" },
    description: "Inspections (archived and incomplete included): template, site, owner, score, started/completed/conducted dates.",
  }),
  // thepubservice_feedinspectionitems
  inspection_items: def("inspection_items", {
    path: "/feed/inspection_items",
    key: field("id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 500,
    query: { archived: "both", completed: "both" },
    description: "Every answered question of every inspection: label, response, failed flag, score, section.",
  }),
  // thepubservice_feedtemplates
  templates: def("templates", {
    path: "/feed/templates",
    key: field("id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 500,
    query: { archived: "both" },
    description: "Templates (archived included): name, owner, author, created and modified dates.",
  }),
  // thepubservice_feedsites: no modified filter; deleted sites kept so historic records still resolve.
  sites: def("sites", {
    path: "/feed/sites",
    key: field("id"),
    pageSize: 500,
    query: { include_deleted: "true", show_only_leaf_nodes: "false" },
    description: "Sites and the levels above them (area, region...): name, type, parent, deleted flag.",
  }),
  // thepubservice_feedusers
  users: def("users", {
    path: "/feed/users",
    key: field("id"),
    pageSize: 500,
    description: "Users: name, email, active flag, seat type, last seen.",
  }),
  // thepubservice_feedgroups
  groups: def("groups", {
    path: "/feed/groups",
    key: field("id"),
    pageSize: 500,
    description: "Groups: id and name.",
  }),
  // thepubservice_feedgroupusers: rows have no id.
  group_users: def("group_users", {
    path: "/feed/group_users",
    key: composite("group_id", "user_id"),
    pageSize: 500,
    description: "Group membership: one row per user per group.",
  }),
  // thepubservice_feedsitemembers: rows have no id.
  site_members: def("site_members", {
    path: "/feed/site_members",
    key: composite("site_id", "member_id"),
    pageSize: 500,
    description: "Site membership: one row per member per site.",
  }),
  // thepubservice_feedactions
  actions: def("actions", {
    path: "/feed/actions",
    key: field("id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 500,
    description: "Actions: title, status, priority, due/created/completed dates, site, inspection and item they came from, labels.",
  }),
  // thepubservice_feedactionassignees: reference lists an id, but the key falls back to action+assignee.
  action_assignees: def("action_assignees", {
    path: "/feed/action_assignees",
    key: idOr("action_id", "assignee_id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 500,
    description: "Action assignees: one row per user or group assigned to an action.",
  }),
  // thepubservice_feedactiontimelineitems: rows carry `timestamp`, not modified_at.
  action_timeline_items: def("action_timeline_items", {
    path: "/feed/action_timeline_items",
    key: field("id"),
    incremental: "modified_after",
    modifiedField: "timestamp",
    pageSize: 500,
    description: "Action history: status, priority, due date and assignee changes, comments.",
  }),
  // thepubservice_feedissues: no modified filter documented.
  issues: def("issues", {
    path: "/feed/issues",
    key: field("id"),
    modifiedField: "modified_at",
    pageSize: 500,
    description: "Issues (incidents): title, category, status, priority, site, occurred/created/completed dates.",
  }),
  // thepubservice_feedissuetimelineitems: no modified filter documented.
  issue_timeline_items: def("issue_timeline_items", {
    path: "/feed/issue_timeline_items",
    key: field("id"),
    modifiedField: "timestamp",
    pageSize: 500,
    description: "Issue history: status changes, comments, field updates.",
  }),
  // schedulingfeedservice_feedschedules (current scheduling feed, not the legacy /feed/schedules)
  schedules: def("schedules", {
    path: "/scheduling/v1/feed/schedules",
    key: field("id"),
    modifiedField: "modified_at",
    pageSize: 1000,
    query: { show_active: "true", show_paused: "true", show_finished: "true" },
    description: "Inspection schedules (active, paused and finished): template, sites, recurrence, assignees, status.",
  }),
  // schedulingfeedservice_feedscheduleassignees
  schedule_assignees: def("schedule_assignees", {
    path: "/scheduling/v1/feed/schedule_assignees",
    key: idOr("schedule_id", "assignee_id"),
    pageSize: 1000,
    query: { show_active: "true", show_paused: "true", show_finished: "true" },
    description: "Schedule assignees: one row per user or group assigned to a schedule.",
  }),
  // schedulingfeedservice_feedscheduleoccurrences: filters by due window only, no modified filter.
  schedule_occurrences: def("schedule_occurrences", {
    path: "/scheduling/v1/feed/schedule_occurrences",
    key: field("id"),
    pageSize: 1000,
    description: "Scheduled inspection occurrences: start, due and miss times, status (completed, missed...), linked inspection.",
  }),
  // thepubservice_feedassets
  assets: def("assets", {
    path: "/feed/assets",
    key: field("id"),
    modifiedField: "modified_at",
    pageSize: 500,
    description: "Assets: code, type, site, state, custom fields.",
  }),
  // thepubservice_feedactivitylogevents: limit capped at 250, incremental on triggered_after.
  activity_log_events: def("activity_log_events", {
    path: "/feed/activity_log_events",
    key: field("id"),
    incremental: "triggered_after",
    modifiedField: "event_at",
    pageSize: 250,
    description: "Activity log: who did what and when (logins, edits, exports).",
  }),
  // feedservice_credentials: deleted documents appear in incremental pulls with deleted=true.
  credentials: def("credentials", {
    path: "/credentials/v1/feed/credentials",
    key: field("document_id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 100,
    description: "Credentials (licences, tickets): holder, type, issue and expiry dates, expiry and approval status.",
  }),
  // feedservice_credentialtypes
  credential_types: def("credential_types", {
    path: "/credentials/v1/feed/credential-types",
    key: field("document_type_id"),
    pageSize: 100,
    description: "Credential types: id and name.",
  }),
  // feedservice_feedcontractorcompanies
  contractor_companies: def("contractor_companies", {
    path: "/companies/v1/feed/companies",
    key: field("company_id"),
    incremental: "modified_after",
    modifiedField: "modified_at",
    pageSize: 100,
    description: "Contractor companies: name, type, status, contact details, address.",
  }),
  // feedservice_feedtrainingcourseprogress: its incremental filter is `modifiedAfter` (camelCase),
  // which FeedDef cannot express, so it is pulled in full. Rows have no id.
  training_course_progress: def("training_course_progress", {
    path: "/training/v1/feed/training-course-progress",
    key: composite("userId", "courseId"),
    pageSize: 100,
    query: { completionStatus: "COMPLETION_STATUS_ALL" },
    description: "Training progress: one row per user per course with progress %, score, completed and due dates.",
  }),
  // feedservice_feedinvestigations: no modified filter documented.
  investigations: def("investigations", {
    path: "/incidents/v1/feed/investigations",
    key: field("investigation_id"),
    modifiedField: "modified_at",
    pageSize: 100,
    description: "Investigations: title, status, category, owner, created and modified dates.",
  }),
};

export const FEED_NAMES = Object.keys(FEEDS) as [FeedName, ...FeedName[]];

/** What sc_sync pulls when no feeds are named: everything the core analytics read. */
export const DEFAULT_SYNC_FEEDS: FeedName[] = [
  "inspections",
  "inspection_items",
  "actions",
  "issues",
  "sites",
  "users",
  "templates",
  "schedules",
  "schedule_occurrences",
];
