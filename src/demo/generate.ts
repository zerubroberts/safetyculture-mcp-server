import type { FeedName } from "../cache/contract.js";

/**
 * Deterministic synthetic organisation for demo mode (SC_DEMO=true): "Northwind Facilities", a
 * fictional facilities company. Every name below is invented and generic. The same anchor date and
 * seed always produce exactly the same organisation; the anchor is today's date (UTC midnight) at
 * startup, so the data always covers "the last 12 months".
 *
 * Rows are stored in the shape of the Data Feeds (docs/api-shapes.md, api-ref feed slugs) because
 * the analytics read those; src/demo/fetch.ts projects the REST shapes from the same rows. Keys that
 * start with "_" are internal helpers and are never served.
 *
 * Built-in patterns (so the analytics have something to find):
 * - weekday-heavy volume with a seasonal bump about four months ago
 * - Eastgate Yard and Harbour Warehouse fail far more items and close actions more slowly
 * - Hilltop Plant starts as the worst site and improves steadily over the year
 * - failures concentrate on five questions (extinguisher tags, blocked exits, PPE, housekeeping, forklift horn)
 * - one inspector (the PENCIL user) completes Northpoint Store inspections in a few minutes, all "Safe"
 * - one burst of three identical inspections within five minutes; a few "bad day" score outliers
 */

export type Row = Record<string, unknown>;
export const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ymd = (ms: number) => iso(ms).slice(0, 10);

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("");
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    weighted: <T>(xs: readonly T[], w: (x: T) => number): T => {
      const total = xs.reduce((s, x) => s + w(x), 0);
      let r = next() * total;
      for (const x of xs) if ((r -= w(x)) < 0) return x;
      return xs[xs.length - 1]!;
    },
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    hex,
    uuid: () => { const h = hex(32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; },
  };
}
export type Rng = ReturnType<typeof rng>;

// ---- Fixed, fictional reference data -------------------------------------------------------
export const ORG_NAME = "Northwind Facilities";
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Harper", "Reese", "Rowan", "Skyler", "Parker", "Emerson", "Hayden", "Logan", "Blake"];
const LAST = ["Carter", "Hughes", "Bennett", "Foster", "Hayes", "Reid", "Shaw", "Walsh", "Ellis", "Grant", "Lane", "Marsh", "Nash", "Pike", "Doyle", "Moss", "Price", "Vance", "Wells", "Young"];
const REGIONS = ["North Region", "Central Region", "South Region"];
/** name, fail multiplier, mean days to close an action, scheduled-miss rate, volume weight */
const SITES: Array<[string, number, number, number, number]> = [
  ["Riverside Depot", 0.8, 4, 0.04, 1.2], ["Harbour Warehouse", 2.3, 16, 0.18, 1.3], ["Hilltop Plant", 1, 9, 0.08, 1.0],
  ["Lakeside Distribution Centre", 0.9, 5, 0.05, 1.4], ["Eastgate Yard", 2.6, 21, 0.22, 1.1], ["Westfield Workshop", 0.7, 3, 0.03, 0.8],
  ["Northpoint Store", 0.9, 6, 0.06, 0.9], ["Southbank Depot", 1, 7, 0.05, 1.0], ["Parkview Office", 0.5, 4, 0.02, 0.5],
  ["Bayside Logistics Hub", 1.1, 8, 0.07, 1.3], ["Meadow Lane Plant", 0.9, 6, 0.06, 0.9], ["Ridgeway Warehouse", 1, 7, 0.05, 1.0],
];
export const WORST_SITES = ["Eastgate Yard", "Harbour Warehouse"];
export const IMPROVING_SITE = "Hilltop Plant";
const IMPROVING = 2;
/** User index of the inspector who rushes inspections (Northpoint Store, site 6). */
export const PENCIL = 6 + 6 * 3 + 1;
const GROUPS = ["Site Managers", "Safety Team", "Warehouse Staff", "Drivers", "Maintenance Crew", "Contractor Liaison", "First Aiders", "Leadership"];
// Question prefixes: "!" failure hotspot, "~" almost always N/A, "^" never fails.
const HOT: Record<string, number> = {
  "Fire extinguisher tag current": 0.2, "Emergency exits clear and unobstructed": 0.16, "Correct PPE worn": 0.13,
  "Housekeeping: walkways clear of debris": 0.12, "Forklift horn working": 0.45,
};
const PPE = "!Correct PPE worn", EXT = "!Fire extinguisher tag current", EXIT = "!Emergency exits clear and unobstructed", HK = "!Housekeeping: walkways clear of debris";
/** name, median seconds, volume weight, questions */
const TEMPLATES: Array<[string, number, number, string[]]> = [
  ["Daily Pre-Start", 420, 3, [PPE, HK, "Work area lighting adequate", "Tools in good condition", "Spill kit available", "First aid kit accessible", "Team briefed on today's tasks", "Hazards identified and controlled", "~Hot work permit in place", "Emergency contact list displayed"]],
  ["Site Safety Walk", 1200, 3, [EXT, EXIT, PPE, HK, "Signage visible and legible", "Electrical leads tested and tagged", "Stacked materials stable", "Chemicals stored correctly", "Eyewash station working", "Machine guards in place", "Ladders in safe condition", "Bins not overflowing", "Lighting working in all areas", "Car park free of hazards", "^Site induction register available", "Noise controls in place"]],
  ["Fire Equipment Check", 900, 2, [EXT, EXIT, "Extinguisher pressure gauge in green", "Fire blanket accessible", "Exit signs illuminated", "Fire doors close fully", "Evacuation diagram displayed", "Alarm panel shows normal", "Sprinkler heads unobstructed", "Assembly point sign visible", "~Fire hose reel tested"]],
  ["Forklift Pre-Use", 300, 3, ["!Forklift horn working", "Brakes working", "Seat belt functional", "Tyres in good condition", "No hydraulic leaks", "Forks free of cracks", "Mast chains lubricated", "Lights and beacon working", "Reversing alarm working", "Load chart visible", "~LPG cylinder secure", "^Operator licence sighted"]],
  ["Hazard Report", 600, 1, ["Hazard is controlled", "Area isolated", "Supervisor notified", "Photos taken", "Risk rating agreed", "Interim control in place", "~Plant tagged out", "Follow-up required"]],
  ["Toolbox Talk Record", 900, 1.5, ["^Attendance recorded", "Topic explained clearly", "Questions answered", PPE, "Recent incidents discussed", "Procedures reviewed", "Feedback captured", "^Talk held at start of shift"]],
  ["Vehicle Inspection", 720, 2, ["Tyres and wheels", "Lights and indicators", "Windscreen and wipers", "Mirrors", "Brakes", "Seat belts", "Fluid levels", "Load restraints", "Fire extinguisher in cab", "First aid kit in cab", "~Hazardous goods stored correctly", "Logbook up to date", "Body free of damage"]],
  ["Warehouse Audit", 1800, 1.5, [EXT, EXIT, HK, "Racking free of damage", "Racking load signs displayed", "Pedestrian walkways marked", "Dock levellers working", "Pallets stacked safely", "Battery charging area ventilated", "Spill kit stocked", "Lighting adequate", "Forklift exclusion zones respected", PPE, "Waste segregated", "Stock clear of sprinklers", "Mezzanine gate closed", "Trolleys in good repair", "Chemical register current", "~Cold room door alarm working", "Floor surface even"]],
  ["First Aid Kit Check", 240, 1.5, ["Kit sealed and complete", "Bandages in date", "Eye wash in date", "Gloves stocked", "Contents list present", "Burns gel in date", "Kit signage visible", "^First aider list displayed"]],
  ["Contractor Induction", 1500, 1, [PPE, "Insurance sighted", "Licence sighted", "Site rules explained", "Emergency procedures explained", "Sign-in process explained", "Permit system explained", "Hazards briefed", "^Induction signed", "Contact person assigned"]],
];
export const ISSUE_CATEGORIES: Array<[string, number, string[]]> = [
  ["Near Miss", 3, ["Forklift and pedestrian near miss", "Stock fell from racking"]], ["Hazard", 3, ["Damaged pallet in aisle", "Trip hazard at dock door"]],
  ["Injury", 1.5, ["Hand laceration while unpacking", "Strained back lifting cartons"]], ["Property Damage", 1.5, ["Racking upright struck", "Roller door damaged"]],
  ["Environmental", 1, ["Oil spill in yard", "Chemical drum leaking"]], ["Security", 1, ["Gate left unlocked overnight", "Unknown visitor on site"]],
  ["Vehicle Incident", 1, ["Van reversed into bollard", "Truck mirror clipped"]], ["Equipment Fault", 2, ["Dock leveller stuck", "Charger tripping breaker"]],
];
export const CREDENTIAL_TYPES = ["Forklift Licence", "Construction Induction Card", "First Aid Certificate", "Working at Heights", "Heavy Vehicle Licence", "Confined Space Entry", "Fire Warden Training", "Electrical Test and Tag"];
export const COMPANIES: Array<[string, string]> = [
  ["Alpha Electrical", "Electrical"], ["Bravo Scaffolding", "Construction"], ["Charlie Cleaning Services", "Cleaning"],
  ["Delta Mechanical", "Maintenance"], ["Echo Grounds Care", "Grounds"], ["Foxtrot Freight", "Transport"],
];
export const ASSET_TYPES: Array<[string, string, number]> = [["Forklift", "FL", 8], ["Fire Extinguisher", "FE", 12], ["Vehicle", "VH", 6], ["Pallet Racking", "PR", 6], ["First Aid Kit", "FA", 5], ["Generator", "GN", 3]];
export const COURSES: Array<[string, number]> = [["Manual Handling Basics", 4], ["Fire Safety Awareness", 3], ["Forklift Safety Refresher", 5], ["Hazard Reporting 101", 3], ["First Aid Essentials", 5], ["Working Safely with Contractors", 4]];
const HEADS_UPS = ["New forklift exclusion zones", "Hot weather hydration reminder", "Updated incident reporting process", "Quarterly fire drill schedule", "Welcome to the new inspection app"];
export const ACTION_LABELS = ["Fire Safety", "Housekeeping", "PPE", "Equipment", "Training"];
export const STATUS_NAME = { to_do: "To do", in_progress: "In progress", complete: "Complete", cant_do: "Can't do" } as const;

export interface DemoOrg {
  now: number;
  orgId: string;
  me: Row;
  feeds: Record<FeedName, Row[]>;
  templates: Array<{ id: string; name: string; responseSetId: string; responses: Array<{ id: string; label: string }>; items: Row[] }>;
  categories: Row[];
  labels: Row[];
  responseSets: Row[];
  assetTypes: Row[];
  assets: Row[];
  programs: Row[];
  courses: Row[];
  paths: Row[];
  headsUps: Row[];
  companyDocs: Row[];
  investigations: Row[];
  documents: { folders: Row[]; files: Row[] };
  sensors: Row[];
  webhooks: Row[];
  permissionSets: Row[];
  issueTimeline: Row[];
}

/** Today's date at 00:00 UTC: the demo organisation's fixed "now". */
export const demoAnchor = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function generateDemoOrg(anchor: number = demoAnchor(), seed = 20261008): DemoOrg {
  const r = rng(seed);
  const NOW = anchor;
  r.hex(32);
  // A fresh organisation ID per anchor day, so the local cache never mixes rows from two different days.
  const orgId = `role_${rng(seed ^ Math.floor(NOW / DAY)).hex(32)}`;
  const base = { organisation_id: orgId };
  const created0 = NOW - 400 * DAY;

  // People
  const users = Array.from({ length: 60 }, (_, i) => {
    const firstname = FIRST[i % 20]!, lastname = LAST[(i * 7 + Math.floor(i / 20)) % 20]!;
    return {
      id: `user_${r.hex(32)}`, ...base, email: `${firstname}.${lastname}${i}@northwind-facilities.example.com`.toLowerCase(), firstname, lastname,
      active: i < 58, last_seen_at: iso(NOW - r.int(0, i < 58 ? 20 : 200) * DAY - r.int(0, 80_000) * 1000), seat_type: i < 42 ? "full" : "free", created_at: iso(created0 + i * DAY),
    } as Row;
  });
  const uid = (i: number) => users[i]!.id as string;
  const uname = (i: number) => `${users[i]!.firstname} ${users[i]!.lastname}`;
  const groups = GROUPS.map((name) => ({ id: r.uuid(), ...base, name }));
  const groupUsers: Row[] = [];
  users.forEach((_, i) => {
    const gs = new Set([i === 0 ? 7 : i < 6 ? 1 : i < 42 ? (i % 3 === 0 ? 0 : 2 + (i % 3)) : 5]);
    if (i % 5 === 0) gs.add(6);
    for (const g of gs) groupUsers.push({ user_id: uid(i), group_id: groups[g]!.id, ...base });
  });

  // Sites: 3 regions, 12 sites. Site i's local inspectors are users 6 + 3i .. 8 + 3i (the first is the site lead).
  const regions = REGIONS.map((name) => {
    const id = r.uuid();
    return { id, name, creator_id: uid(0), ...base, deleted: false, site_uuid: id, meta_label: "region", parent_id: "" };
  });
  const sites = SITES.map(([name], i) => {
    const id = r.uuid();
    return { id, name, creator_id: uid(0), ...base, deleted: false, site_uuid: id, meta_label: "site", parent_id: regions[i % 3]!.id };
  });
  const local = (s: number) => [6 + 3 * s, 7 + 3 * s, 8 + 3 * s];
  const siteMembers: Row[] = [];
  sites.forEach((s, i) => [...local(i), 1, 2, 3, 4, 5].forEach((u) => siteMembers.push({ site_id: s.id, member_id: uid(u), ...base })));

  // Templates
  const templates = TEMPLATES.map(([name], ti) => {
    const id = `template_${r.hex(32)}`;
    const responseSetId = r.uuid();
    const responses = ["Safe", "At Risk", "N/A"].map((label) => ({ id: r.uuid(), label }));
    const sec = [{ item_id: r.uuid(), type: "section", label: "Checks" }, { item_id: r.uuid(), type: "section", label: "Sign-off" }];
    const qs = TEMPLATES[ti]![3].map((q) => ({ item_id: r.uuid(), type: ti === 4 ? "list" : "question", label: q.replace(/^[!~^]/, ""), parent_id: sec[0]!.item_id, _flag: q[0] }));
    const tail = [
      { item_id: r.uuid(), type: "datetime", label: "Conducted on", parent_id: sec[1]!.item_id },
      { item_id: r.uuid(), type: "text", label: "Notes", parent_id: sec[1]!.item_id },
      { item_id: r.uuid(), type: "signature", label: "Inspector signature", parent_id: sec[1]!.item_id },
    ];
    return { id, name, responseSetId, responses, items: [sec[0]!, ...qs, sec[1]!, ...tail] as Row[] };
  });
  const templateRows = templates.map((t, i) => ({
    id: t.id, archived: false, name: t.name, description: `${t.name} checklist for ${ORG_NAME} sites.`, owner_name: uname(1), owner_id: uid(1),
    author_name: uname(2), author_id: uid(2), ...base, created_at: iso(created0 + i * 3 * DAY), modified_at: iso(NOW - (60 + i * 11) * DAY),
  }));

  // Inspections and their items
  const inspections: Row[] = [];
  const items: Row[] = [];
  const failures: Array<{ insp: Row; item: Row; label: string; site: number }> = [];
  const conduct = (ti: number, si: number, owner: number, start: number, opts: { fast?: boolean; badDay?: boolean; incomplete?: boolean } = {}) => {
    const t = templates[ti]!;
    const median = TEMPLATES[ti]![1];
    const fast = opts.fast || owner === PENCIL;
    const duration = Math.round(fast ? r.int(45, 140) : median * Math.exp(0.3 * r.normal()));
    const done = opts.incomplete ? undefined : start + duration * 1000;
    const progress = (start - (NOW - 365 * DAY)) / (365 * DAY);
    const mult = owner === PENCIL ? 0 : (si === IMPROVING ? 2.6 - 2.1 * progress : SITES[si]![1]) * (opts.badDay ? 7 : 1);
    const auditId = `audit_${r.hex(32)}`;
    let safe = 0, total = 0;
    const modified = (done ?? start) + r.int(5, 600) * 1000;
    const rowsHere: Row[] = [];
    t.items.forEach((it, idx) => {
      const row: Row = {
        id: `${auditId}_${it.item_id}`, item_id: it.item_id, audit_id: auditId, item_index: idx, template_id: t.id, parent_id: it.parent_id ?? null, ...base,
        created_at: iso(start), modified_at: iso(modified), type: it.type, category: it.parent_id === t.items[0]!.item_id ? "Checks" : it.type === "section" ? "" : "Sign-off",
        category_id: it.parent_id ?? "", label: it.label, response: "", response_id: null, response_set_id: null, is_failed_response: false, comment: null,
        score: 0, max_score: 0, score_percentage: 0, mandatory: false, inactive: false,
      };
      if (it.type === "question" || it.type === "list") {
        const flag = it._flag as string;
        const na = flag === "~" ? 0.92 : 0.03;
        const failP = flag === "^" ? 0 : Math.min(0.9, (flag === "!" ? HOT[it.label as string]! : 0.024) * mult);
        const resp = r.chance(na) ? 2 : r.chance(failP) ? 1 : 0;
        Object.assign(row, { response: t.responses[resp]!.label, response_id: t.responses[resp]!.id, response_set_id: t.responseSetId, is_failed_response: resp === 1 });
        if (resp !== 2) Object.assign(row, { score: resp === 0 ? 1 : 0, max_score: 1, score_percentage: resp === 0 ? 100 : 0 }), total++, (safe += resp === 0 ? 1 : 0);
        if (resp === 1) row.comment = "Raised with the site lead.";
      } else if (it.type === "datetime") row.response = iso(start);
      else if (it.type === "text") row.response = "No further notes.";
      else if (it.type === "signature") row.response = uname(owner);
      rowsHere.push(row);
    });
    const insp: Row = {
      id: auditId, name: `${t.name} - ${sites[si]!.name} - ${new Date(start).toUTCString().slice(5, 16)}`, archived: false, ...base,
      owner_name: uname(owner), owner_id: uid(owner), author_name: uname(owner), author_id: uid(owner), score: safe, max_score: total,
      score_percentage: total ? Math.round((safe / total) * 10000) / 100 : 0, duration, site_id: sites[si]!.id, template_id: t.id, template_name: t.name,
      date_started: iso(start), date_completed: done ? iso(done) : null, date_modified: iso(modified), created_at: iso(start), modified_at: iso(modified), _site: si, _template: ti, _owner: owner,
    };
    inspections.push(insp);
    for (const row of rowsHere) {
      items.push(row);
      if (row.is_failed_response && done) failures.push({ insp, item: row, label: row.label as string, site: si });
    }
    return insp;
  };

  // Schedules: a weekly Site Safety Walk per site, a monthly Fire Equipment Check at six sites.
  const schedules: Row[] = [], scheduleAssignees: Row[] = [], occurrences: Row[] = [];
  const monday = NOW - (((new Date(NOW).getUTCDay() + 6) % 7) * DAY);
  const plan: Array<[number, number, "WEEKLY" | "MONTHLY"]> = [...sites.map((_, i) => [1, i, "WEEKLY"] as [number, number, "WEEKLY"]), ...[0, 1, 2, 3, 4, 5].map((i) => [2, i, "MONTHLY"] as [number, number, "MONTHLY"])];
  for (const [ti, si, freq] of plan) {
    const id = r.uuid();
    const lead = local(si)[0]!;
    const paused = freq === "WEEKLY" && si === 11;
    const firstStart = freq === "WEEKLY" ? monday - 26 * 7 * DAY : Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth() - 6, 1);
    schedules.push({
      id, title: `${TEMPLATES[ti]![0]} - ${sites[si]!.name}`, recurrence: `DTSTART:${ymd(firstStart).replaceAll("-", "")}T000000Z\nRRULE:${freq === "WEEKLY" ? "FREQ=WEEKLY;BYDAY=MO" : "FREQ=MONTHLY;BYMONTHDAY=1"}`,
      duration: freq === "WEEKLY" ? "P5D" : "P14D", modified_at: iso(NOW - (paused ? 30 : 90) * DAY), ...base, created_at: iso(firstStart - 7 * DAY), completion_rule: "COMPLETION_RULE_ANY",
      status: paused ? "PAUSED" : "ACTIVE", timezone: "UTC", is_late_submit_allowed: true, site_ids: [sites[si]!.id], template_id: templates[ti]!.id, created_by: uid(1),
      assignees: [uid(lead)], schedule_type: "SCHEDULE_TYPE_USERS", asset_ids: [], _site: si, _template: ti,
    });
    scheduleAssignees.push({ id: r.uuid(), schedule_id: id, assignee_id: uid(lead), type: "user", name: uname(lead), ...base, completion_rule: "COMPLETION_RULE_ANY" });
    for (let k = 0; ; k++) {
      const start = freq === "WEEKLY" ? firstStart + k * 7 * DAY : Date.UTC(new Date(firstStart).getUTCFullYear(), new Date(firstStart).getUTCMonth() + k, 1);
      if (start > NOW + 14 * DAY || (paused && start > NOW - 30 * DAY)) break;
      const due = start + (freq === "WEEKLY" ? 5 : 14) * DAY - 60_000;
      const miss = due + 2 * DAY;
      let status = "TODO", audit = "", completed = "";
      if (start <= NOW) {
        const x = r.next();
        const missed = x < SITES[si]![3], late = !missed && x < SITES[si]![3] + 0.07;
        if (due > NOW ? r.chance(0.5) : !missed) {
          const at = late && miss < NOW ? due + r.int(2, 40) * 3_600_000 : start + r.int(4, Math.max(5, Math.floor((Math.min(due, NOW) - start) / 3_600_000) - 1)) * 3_600_000;
          const insp = conduct(ti, si, lead, at - TEMPLATES[ti]![1] * 1000);
          audit = insp.id as string;
          completed = insp.date_completed as string;
          status = late && miss < NOW ? "LATE" : "COMPLETED";
        } else if (due <= NOW) status = "MISSED";
      }
      occurrences.push({
        id: r.uuid(), schedule_id: id, occurrence_id: `${id}:${start}`, template_id: templates[ti]!.id, start_time: iso(start), due_time: iso(due), miss_time: iso(miss),
        occurrence_status: status, audit_id: audit, completed_at: completed, completion_rule: "COMPLETION_RULE_ANY", ...base, wont_do_note: "", assignee_id: uid(lead), assignee_from: "user",
      });
    }
  }

  // Ad-hoc inspections: weekday-heavy, seasonal bump ~120 days ago, ~1,800 in total with the scheduled ones.
  for (let d = 365; d >= 1; d--) {
    const day = NOW - d * DAY;
    const dow = new Date(day).getUTCDay();
    const n = Math.floor((dow === 0 ? 0.4 : dow === 6 ? 1.2 : 4.9) * (0.85 + 0.3 * (1 - d / 365)) * (1 + 0.6 * Math.exp(-(((d - 120) / 25) ** 2))) + r.next());
    for (let k = 0; k < n; k++) {
      const si = SITES.indexOf(r.weighted(SITES, (s) => s[4]));
      const pencil = si === 6 && r.chance(0.5);
      const ti = pencil ? 1 : TEMPLATES.indexOf(r.weighted(TEMPLATES, (t) => t[2]));
      const owner = pencil ? PENCIL : r.chance(0.2) ? r.int(1, 5) : local(si)[r.int(0, 2)]!;
      conduct(ti, si, owner, day + r.int(6 * 60, 16 * 60) * 60_000, { badDay: r.chance(0.008), incomplete: d < 20 && r.chance(0.04) });
    }
  }
  // A burst: three Forklift Pre-Use inspections by one inspector inside five minutes.
  const burstAt = NOW - 9 * DAY + 10 * 3_600_000;
  for (let k = 0; k < 3; k++) conduct(3, 9, local(9)[1]!, burstAt + k * 100_000);
  inspections.forEach((i, k) => { if (k % 67 === 5) (i.archived = true), (i.modified_at = iso(Math.min(NOW - 1000, Date.parse(i.modified_at as string) + 2 * DAY))); });

  // Actions: about 450, raised from failed items, closing speed differs by site.
  const actions: Row[] = [], assignees: Row[] = [], timeline: Row[] = [];
  const keep = Math.min(1, 450 / Math.max(1, failures.length));
  const labelOf = (l: string) => (/extinguisher|exit|fire/i.test(l) ? 0 : /housekeeping|bins|waste/i.test(l) ? 1 : /ppe/i.test(l) ? 2 : /training|induction|talk/i.test(l) ? 4 : 3);
  const labels = ACTION_LABELS.map((label_name) => ({ label_id: r.uuid(), label_name }));
  const event = (task: string, at: number, by: number, type: string, data: Row) =>
    timeline.push({ id: r.uuid(), task_id: task, ...base, task_creator_id: uid(by), task_creator_name: uname(by), timestamp: iso(at), creator_id: uid(by), creator_name: uname(by), item_type: type, item_data: JSON.stringify(data) });
  for (const f of failures) {
    if (!r.chance(keep)) continue;
    const id = r.uuid();
    const created = Date.parse(f.insp.date_completed as string) + r.int(20, 360) * 60_000;
    if (created >= NOW) continue;
    const hot = f.label in HOT;
    const priority = hot && /extinguisher|exit/i.test(f.label) ? (r.chance(0.6) ? "High" : "Medium") : r.pick(["High", "Medium", "Medium", "Low", "Low"]);
    const due = created + ({ High: 3, Medium: 7, Low: 14 }[priority] ?? 7) * DAY;
    const days = -Math.log(1 - r.next()) * SITES[f.site]![2] * (priority === "Low" ? 1.4 : 1);
    const lead = local(f.site)[0]!;
    const by = f.insp._owner as number;
    let status: keyof typeof STATUS_NAME = r.chance(0.4) ? "in_progress" : "to_do";
    let completed: number | undefined;
    if (created + days * DAY < NOW && r.chance(0.9)) (status = r.chance(0.05) ? "cant_do" : "complete"), (completed = created + days * DAY);
    const label = labels[labelOf(f.label)]!;
    actions.push({
      id, title: `${f.label}: fix at ${sites[f.site]!.name}`, site_id: sites[f.site]!.id, description: `Raised from a failed item in "${f.insp.name}".`, priority, status: STATUS_NAME[status],
      due_date: iso(due), creator_user_id: uid(by), creator_user_name: uname(by), created_at: iso(created), modified_at: iso(completed ?? created + DAY), template_id: f.insp.template_id, ...base,
      audit_id: f.insp.id, audit_title: f.insp.name, audit_item_id: f.item.item_id, audit_item_label: f.label, completed_at: completed ? iso(completed) : null,
      action_label: `{"label_id":"${label.label_id}"|"label_name":"${label.label_name}"}`, unique_id: `ACT-${1000 + actions.length}`, type_id: "", type_name: "Corrective action", _assignee: lead,
    });
    assignees.push({ id: r.uuid(), action_id: id, assignee_id: uid(lead), name: uname(lead), ...base, modified_at: iso(created), type: "USER" });
    event(id, created, by, "TASK_CREATED", { title: f.label });
    if (r.chance(0.12)) event(id, created + days * 0.2 * DAY, 1, "TASK_ASSIGNEE_UPDATED", { assignee_id: uid(lead) });
    if (status !== "to_do") event(id, Math.min(NOW - 60_000, created + days * 0.3 * DAY), lead, "TASK_STATUS_UPDATED", { status_id: "in_progress", status_label: "In progress" });
    if (completed) event(id, completed, lead, "TASK_STATUS_UPDATED", { status_label: STATUS_NAME[status] });
  }

  // Issues: about 120 across 8 categories, more at the riskier sites, rising lately.
  const categories = ISSUE_CATEGORIES.map(([label, , ], i) => ({ id: r.uuid(), key: label.toLowerCase().replace(/ /g, "_"), label, description: `${label} reports.`, _i: i }));
  const issues: Row[] = [], issueTimeline: Row[] = [];
  for (let k = 0; k < 120; k++) {
    // Denser towards today, so the issue count is rising.
    const at = NOW - Math.floor(365 * (1 - Math.sqrt(r.next()))) * DAY - r.int(3_600, 80_000) * 1000;
    const si = SITES.indexOf(r.weighted(SITES, (s) => s[1] * s[4]));
    const ci = ISSUE_CATEGORIES.indexOf(r.weighted(ISSUE_CATEGORIES, (c) => c[1]));
    const cat = categories[ci]!;
    const by = local(si)[r.int(0, 2)]!;
    const resolved = at < NOW - 10 * DAY ? r.chance(0.85) : r.chance(0.3);
    const done = resolved ? Math.min(NOW - 60_000, at + r.int(1, 20) * DAY) : undefined;
    const id = r.uuid();
    issues.push({
      id, title: r.pick(ISSUE_CATEGORIES[ci]![2]), description: `Reported at ${sites[si]!.name}.`, creator_id: uid(by), creator_user_name: uname(by), created_at: iso(at), due_at: iso(at + 14 * DAY),
      priority: r.pick(["High", "Medium", "Medium", "Low", "None"]), status: resolved ? "Resolved" : "Open", template_id: "", inspection_id: "", inspection_name: "", site_id: sites[si]!.id,
      site_name: sites[si]!.name, location_name: sites[si]!.name, category_id: cat.id, category_label: cat.label, category_description: cat.description, modified_at: iso(done ?? at + 3_600_000), completed_at: done ? iso(done) : null,
      unique_id: `ISS-${100 + k}`, occurred_at: iso(at - r.int(10, 240) * 60_000), ...base, _creator: by,
    });
    issueTimeline.push({ id: r.uuid(), task_id: id, ...base, task_creator_id: uid(by), task_creator_name: uname(by), timestamp: iso(at), creator_id: uid(by), creator_name: uname(by), item_type: "TASK_CREATED", item_data: "{}" });
    if (done) issueTimeline.push({ id: r.uuid(), task_id: id, ...base, task_creator_id: uid(by), task_creator_name: uname(by), timestamp: iso(done), creator_id: uid(1), creator_name: uname(1), item_type: "TASK_STATUS_UPDATED", item_data: '{"status":"Resolved"}' });
  }

  // Credentials: 150 for users 6..59, unique per person and type; some expired, several expiring soon.
  const credTypes = CREDENTIAL_TYPES.map((name) => ({ document_type_id: r.uuid(), document_type_name: name }));
  const credentials: Row[] = [];
  for (let i = 0; i < 150; i++) {
    const u = 6 + (i % 54), t = credTypes[(3 * i + Math.floor(i / 54)) % 8]!;
    const x = r.next();
    const days = x < 0.1 ? -r.int(1, 200) : x < 0.19 ? r.int(1, 30) : x < 0.24 ? r.int(31, 90) : x < 0.28 ? null : r.int(91, 900);
    const exp = days === null ? undefined : NOW + days * DAY;
    const issued = (exp ?? NOW) - r.int(700, 1100) * DAY;
    const pending = r.chance(0.05);
    credentials.push({
      document_id: r.uuid(), document_version_id: r.uuid(), ...t, subject_user_id: uid(u), subject_user_first_name: users[u]!.firstname, subject_user_last_name: users[u]!.lastname,
      issue_date: ymd(issued), expiry_date: exp ? ymd(exp) : "", expiry_status: exp === undefined ? "" : days! < 0 ? "EXPIRY_STATUS_EXPIRED" : days! <= 30 ? "EXPIRY_STATUS_EXPIRING_SOON" : "EXPIRY_STATUS_VALID",
      approval_status: pending ? "PENDING" : "APPROVED", created_at: iso(issued), modified_at: iso(Math.min(NOW - DAY, issued + 2 * DAY)), deleted: false,
    });
  }

  // Contractor companies: six, two workers each (users 42..53), three company documents each.
  const companyTypes = [...new Set(COMPANIES.map((c) => c[1]))].map((name) => ({ id: r.uuid(), name }));
  const companyDocs: Row[] = [];
  const companies = COMPANIES.map(([name, type], i) => {
    const company_id = r.uuid();
    ["Public Liability Insurance", "Safe Work Method Statement", "Workers Compensation Certificate"].forEach((title, j) => {
      const days = i === 1 && j === 0 ? -12 : i === 4 && j === 2 ? 18 : r.int(60, 500);
      companyDocs.push({ id: r.uuid(), company_id, title, approval_status: "APPROVAL_STATUS_APPROVED", doc_expiry_status: days < 0 ? "EXPIRY_STATUS_EXPIRED" : days <= 30 ? "EXPIRY_STATUS_EXPIRING_SOON" : "EXPIRY_STATUS_VALID", _expiry: NOW + days * DAY, _type: title });
    });
    const t = companyTypes.find((x) => x.name === type)!;
    return {
      company_id, company_name: name, company_type_id: t.id, company_type_name: t.name, email: `office@${name.toLowerCase().replace(/[^a-z]/g, "")}.example.com`, phone_number: `+1 555 01${10 + i}`,
      address_street: `${10 + i * 7} Example Street`, address_city: "Springfield", address_country_code: "US", status: i === 5 ? "CONTRACTOR_COMPANY_STATUS_PENDING" : "CONTRACTOR_COMPANY_STATUS_ACTIVE",
      created_at: iso(created0 + i * 9 * DAY), modified_at: iso(NOW - (5 + i * 13) * DAY), _users: [42 + 2 * i, 43 + 2 * i], _sites: [sites[i]!.id, sites[i + 6]!.id],
    } as Row;
  });

  // Assets: 40 across 6 types; two maintenance programs.
  const assetTypes = ASSET_TYPES.map(([name]) => ({ id: r.uuid(), name, type: "TYPE_CATEGORY_PREDEFINED" }));
  const fieldDefs = ["Serial number", "Make", "Model"].map((name) => ({ id: r.uuid(), name, field_type: "FIELD_TYPE_DEFAULT", value_type: "FIELD_VALUE_TYPE_STRING" }));
  const assets: Row[] = [];
  ASSET_TYPES.forEach(([, prefix, n], ti) => {
    for (let k = 1; k <= n; k++) {
      const si = (assets.length * 5) % 12;
      assets.push({
        id: r.uuid(), code: `${prefix}-${String(k).padStart(3, "0")}`, _type: ti, _site: si, state: assets.length % 19 === 18 ? "ASSET_STATE_ARCHIVED" : "ASSET_STATE_ACTIVE",
        _fields: [`SN-${r.int(10000, 99999)}`, r.pick(["Generic Co", "Standard Works", "Example Make"]), `Model ${r.pick(["A", "B", "C"])}${r.int(1, 9)}`],
        created_at: iso(created0 + assets.length * DAY), modified_at: iso(NOW - r.int(1, 120) * DAY), inspected_at: iso(NOW - r.int(1, 60) * DAY),
        _service: r.weighted(["ASSET_SERVICE_STATUS_SCHEDULED", "ASSET_SERVICE_STATUS_DUE_SOON", "ASSET_SERVICE_STATUS_OVERDUE"], (s) => (s.endsWith("SCHEDULED") ? 6 : 2)),
      });
    }
  });
  const programs = [["Forklift Servicing", 0], ["Fire Equipment Servicing", 1]].map(([name, type]) => ({ id: r.uuid(), name, description: `${name} plan`, _type: type, plan: { id: r.uuid(), name: `${name}: every 3 months` } }));

  // Training: 6 courses, 2 paths, one leaderboard, progress for users 1..53 (three courses each).
  const courses = COURSES.map(([title, lessons], i) => ({
    id: r.uuid(), title, description: `${title} for ${ORG_NAME} staff.`, status: "PUBLISHED", locale: "en", isMandatory: i < 3, duration: lessons * 600, isPublished: true, lessonCount: lessons,
    createdDatetime: iso(created0 + i * 20 * DAY), modifiedDatetime: iso(NOW - (30 + i * 9) * DAY), _lessons: Array.from({ length: lessons }, (_, k) => ({ id: r.uuid(), title: `Lesson ${k + 1}`, status: "PUBLISHED", minimumScore: 80 })),
  }));
  const progress: Row[] = [];
  for (let u = 1; u < 54; u++)
    for (const c of [courses[u % 6]!, courses[(u + 2) % 6]!, courses[(u + 4) % 6]!]) {
      const total = c.lessonCount, done = r.chance(0.6) ? total : r.int(0, total - 1);
      progress.push({
        openedAt: done ? iso(NOW - r.int(30, 300) * DAY) : "", completedAt: done === total ? iso(NOW - r.int(1, 29) * DAY) : "", totalLessons: total, completedLessons: done, courseId: c.id, courseExternalId: "",
        courseTitle: c.title, userEmail: users[u]!.email, userFirstName: users[u]!.firstname, userLastName: users[u]!.lastname, userId: uid(u), userExternalId: "", progressPercent: Math.round((done / total) * 100),
        score: done === total ? r.int(75, 100) : 0, dueAt: c.isMandatory ? iso(NOW + r.int(-20, 60) * DAY) : "", completionExpiryDate: "", timeSpentSeconds: done * r.int(300, 900),
      });
    }
  const paths = [{ id: r.uuid(), title: "New starter safety path", isPublished: true }, { id: r.uuid(), title: "Warehouse operator path", isPublished: true }];

  const headsUps = HEADS_UPS.map((title, i) => {
    const assigned = Array.from({ length: 20 + i * 6 }, (_, k) => 1 + ((k * 3 + i) % 53));
    return {
      id: r.uuid(), title, description: `${title}. Please read and acknowledge.`, published_at: iso(NOW - (4 + i * 17) * DAY), author_id: uid(1), author_name: uname(1), has_acknowledgement: i !== 4,
      _assigned: assigned, _done: assigned.map(() => r.chance(0.55 + i * 0.08)), _comments: i < 3 ? [[assigned[0]!, "Thanks, noted."], [assigned[1]!, "Will brief the team at the next toolbox talk."]] : [],
    } as Row;
  });

  const investigations = ["Forklift and pedestrian near miss review", "Racking strike root cause", "Hand laceration investigation", "Oil spill containment review"].map((title, i) => ({
    investigation_id: r.uuid(), title, description: `${title} at ${sites[[4, 1, 2, 9][i]!]!.name}.`, created_at: iso(NOW - (70 - i * 15) * DAY), modified_at: iso(NOW - (20 - i * 4) * DAY),
    status: { status_id: r.uuid(), title: i === 0 ? "Closed" : "In progress" }, identifier: { prefix: "INV", sequence: i + 1, for_display: `INV-${i + 1}` },
    creator: { user_id: uid(1), display_name: uname(1) }, owner: { user_id: uid(2), display_name: uname(2) }, category: { category_id: categories[[0, 3, 2, 4][i]!]!.id, title: categories[[0, 3, 2, 4][i]!]!.label },
    _issue: issues[i * 7]!.id, _action: actions[i * 11]?.id, _inspection: inspections[i * 40]!.id,
  }));

  const folders = ["Policies", "Safe Work Procedures", "Emergency Plans"].map((name, i) => ({ folder_id: r.uuid(), name, modified_at: iso(NOW - (10 + i * 30) * DAY), child_count: 3 }));
  const files = ["Safety Policy", "Incident Reporting Procedure", "PPE Standard", "Forklift Operation SWP", "Working at Heights SWP", "Hot Work SWP", "Evacuation Plan", "Spill Response Plan", "Severe Weather Plan"].map((name, i) => ({
    file_id: r.uuid(), name: `${name}.pdf`, description: name, file_extension: "pdf", file_size: 120_000 + i * 31_000, modified_at: iso(NOW - (5 + i * 21) * DAY),
    expiry_status: i === 4 ? "EXPIRY_STATUS_EXPIRED" : "EXPIRY_STATUS_VALID", valid_to: { year: new Date(NOW).getUTCFullYear() + (i === 4 ? -1 : 1), month: 6, day: 30 }, _folder: Math.floor(i / 3),
  }));

  const sensors = ["Cold room 1", "Cold room 2", "Server room"].map((name, i) => ({ source_name: "demo-sensors", source_id: `sensor-${i + 1}`, asset_id: assets[i]!.id, asset_name: assets[i]!.code, asset_timezone: "UTC", location_name: name, site_id: sites[[3, 3, 8][i]!]!.id }));
  const me = { user_id: uid(0), organisation_id: orgId, firstname: users[0]!.firstname, lastname: users[0]!.lastname, email: users[0]!.email, organisation_name: ORG_NAME };
  const activity = inspections.filter((i) => i.date_completed && Date.parse(i.date_completed as string) > NOW - 60 * DAY).map((i) => ({
    id: r.uuid(), event_at: i.date_completed, type: "inspection_completed", user_id: i.owner_id, ...base, client_class: "mobile", agent: "demo", metadata: JSON.stringify({ audit_id: i.id }), remote_ip: "192.0.2.10", initiator: "user",
  }));

  const feeds: Record<FeedName, Row[]> = {
    inspections, inspection_items: items, templates: templateRows, sites: [...regions, ...sites], users, groups, group_users: groupUsers, site_members: siteMembers,
    actions, action_assignees: assignees, action_timeline_items: timeline, issues, issue_timeline_items: issueTimeline, schedules, schedule_assignees: scheduleAssignees,
    schedule_occurrences: occurrences,
    assets: assets.map((a) => ({ id: a.id, code: a.code, type_id: assetTypes[a._type as number]!.id, type_name: assetTypes[a._type as number]!.name, fields: JSON.stringify(a._fields), created_at: a.created_at, modified_at: a.modified_at, site_id: sites[a._site as number]!.id, state: a.state, status_options: "[]" })),
    activity_log_events: activity, credentials, credential_types: credTypes, contractor_companies: companies, training_course_progress: progress,
    investigations: investigations.map((v) => ({ investigation_id: v.investigation_id, title: v.title, description: v.description, created_at: v.created_at, modified_at: v.modified_at, status_id: v.status.status_id, status_title: v.status.title, identifier_for_display: v.identifier.for_display, creator_id: v.creator.user_id, owner_id: v.owner.user_id, category_id: v.category.category_id, category_title: v.category.title })),
  };
  return {
    now: NOW, orgId, me, feeds, templates, categories, labels, assetTypes, assets, programs, courses, paths, headsUps, companyDocs, investigations, sensors, issueTimeline,
    responseSets: [["Safe / At Risk / N/A", "Safe|At Risk|N/A"], ["Yes / No / N/A", "Yes|No|N/A"]].map(([name, opts]) => ({ responseset_id: r.uuid(), name, created_at: iso(created0), updated_at: iso(created0 + 30 * DAY), responses: opts!.split("|").map((label) => ({ id: r.uuid(), label, short_label: label })) })),
    documents: { folders, files },
    webhooks: [{ webhook_id: r.uuid(), trigger_events: ["TRIGGER_EVENT_INSPECTION_COMPLETED", "TRIGGER_EVENT_ACTION_CREATED"], url: "https://hooks.example.com/northwind", user_id: uid(0), organisation_id: orgId, enabled: true, created_at: iso(NOW - 90 * DAY), updated_at: iso(NOW - 30 * DAY) }],
    permissionSets: ["Administrator", "Manager", "Inspector", "Contractor"].map((name, i) => ({ permission_set: { identifier: { id: r.uuid(), type: i === 0 ? "PERMISSION_SET_TYPE_SYSTEM" : "PERMISSION_SET_TYPE_CUSTOM", name, description: `${name} access`, allowed_seat_types: [i < 3 ? "SUBSCRIPTION_SEAT_TYPE_FULL" : "SUBSCRIPTION_SEAT_TYPE_FREE"] }, modified_at: iso(NOW - 100 * DAY), permissions: { inspections_conduct: true, actions_manage: i < 3, users_manage: i === 0 } } })),
  };
}
