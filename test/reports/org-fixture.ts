// Synthetic organisation shared by the report tests: two sites, three inspectors, actions with
// assignees, weekly schedules. No real data.
import type { FeedName } from "../../src/cache/contract.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, issue, item, site } from "./fixtures.js";

export const EVIL = '<script>alert("x")</script>';
export const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Synthetic organisation: two sites, three inspectors, actions with assignees, weekly schedules. */
export function data(): Partial<Record<FeedName, Record<string, unknown>[]>> {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const owners = [
    ["user_a", `Alex ${EVIL}`],
    ["user_b", "Blair Sample"],
    ["user_c", "Casey Example"],
  ];
  for (let k = 0; k < 90; k++) {
    const id = `audit_q${k}`;
    const [owner, ownerName] = owners[k % 3]!;
    inspections.push(insp(id, { tpl: k % 4 ? "template_t1" : "template_t2", tplName: k % 4 ? `Pre-start ${EVIL}` : "Site walk", site: k % 2 ? "site-1" : "site-2", owner, ownerName, completed: DAYS(1 + (k % 80)), score: 80 + (k % 20), duration: 300 + k * 7 }));
    items.push(item(id, `Guard ${EVIL}`, { tpl: k % 4 ? "template_t1" : "template_t2", response: k % 3 ? "Yes" : "No", failed: k % 3 === 0 }), item(id, "Lights", { tpl: k % 4 ? "template_t1" : "template_t2" }), item(id, "Exits", { tpl: k % 4 ? "template_t1" : "template_t2", response: k % 5 ? "Yes" : "No", failed: k % 5 === 0 }));
  }
  const actions = [
    action("a-1", { title: `Fix guard ${EVIL}`, priority: "HIGH", site: "site-1", created: DAYS(120), due: DAYS(100) }),
    action("a-2", { title: "Replace sign", priority: "LOW", site: "site-1", created: DAYS(20), due: DAYS(5) }),
    action("a-3", { title: "Mop", priority: "MEDIUM", site: "site-2", created: DAYS(10), due: DAYS(-10) }),
    action("a-4", { title: "Done one", status: "COMPLETE", site: "site-2", created: DAYS(30), completed: DAYS(25) }),
    action("a-5", { title: "No date", priority: "HIGH", site: "site-2", created: DAYS(3), due: null }),
  ];
  const assignees = [
    { id: "aa-1", action_id: "a-1", assignee_id: "user_a", name: `Alex ${EVIL}`, type: "USER", organisation_id: "role_demo-org-0001" },
    { id: "aa-2", action_id: "a-2", assignee_id: "user_a", name: `Alex ${EVIL}`, type: "USER", organisation_id: "role_demo-org-0001" },
    { id: "aa-3", action_id: "a-3", assignee_id: "user_b", name: "Blair Sample", type: "USER", organisation_id: "role_demo-org-0001" },
    { id: "aa-4", action_id: "a-2", assignee_id: "user_b", name: "Blair Sample", type: "USER", organisation_id: "role_demo-org-0001" },
  ];
  const occurrences: Record<string, unknown>[] = [];
  const statuses = ["COMPLETED", "COMPLETED", "LATE", "MISSED", "COMPLETED"];
  for (let w = 0; w < 12; w++)
    for (const [s, schedule] of [["site-1", "sched-1"], ["site-2", "sched-2"]] as const)
      occurrences.push({ id: `occ-${schedule}-${w}`, schedule_id: schedule, occurrence_id: `o-${w}`, template_id: "template_t1", due_time: DAYS(2 + w * 7), occurrence_status: statuses[(w + (s === "site-1" ? 0 : 2)) % 5], assignee_from: `location_${s}` });
  return {
    inspections,
    inspection_items: items,
    actions,
    action_assignees: assignees,
    issues: [issue("i-1", { category: "Slip", created: DAYS(3), priority: "High" })],
    schedule_occurrences: occurrences,
    schedules: [
      { id: "sched-1", title: `Walk ${EVIL}`, site_ids: ["site-1"], template_id: "template_t1" },
      { id: "sched-2", title: "Walk two", site_ids: ["site-2"], template_id: "template_t1" },
    ],
    schedule_assignees: [],
    sites: [site("site-1", `Depot ${EVIL}`), site("site-2", "Yard")],
    templates: [
      { id: "template_t1", name: `Pre-start ${EVIL}`, organisation_id: "role_demo-org-0001" },
      { id: "template_t2", name: "Site walk", organisation_id: "role_demo-org-0001" },
    ],
    users: [],
  };
}

export function fake(d = data()): FakeCache {
  const c = new FakeCache();
  for (const [feed, rows] of Object.entries(d)) c.seed(feed as FeedName, rows);
  return c;
}

