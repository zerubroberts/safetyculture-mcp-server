import { z } from "zod";
import { ids, P } from "../core/params.js";
import { defineTool } from "../core/registry.js";
import { inPeriod, parsePeriod } from "../core/time.js";

/**
 * Contractor companies, company documents and credentials (licences, tickets, expiry).
 * Contracts verified against the cached API reference 2026-10-08
 * (contractorsservice_listcontractorcompanies, contractorsservice_getcontractorcompany,
 * companydocumentsservice_listcompanydocuments, documenttypesservice_listdocumenttypes,
 * userdocumentsservice_getdocuments, contractorsservice_listcompanyusermetadata).
 */

const COMPANY_STATUS_API = {
  active: "CONTRACTOR_COMPANY_STATUS_ACTIVE",
  pending: "CONTRACTOR_COMPANY_STATUS_PENDING",
  deactivated: "CONTRACTOR_COMPANY_STATUS_DEACTIVATED",
} as const;
const companyStatus = z.enum(["active", "pending", "deactivated"]);

const DOC_EXPIRY_API = {
  valid: "EXPIRY_STATUS_VALID",
  expiring_soon: "EXPIRY_STATUS_EXPIRING_SOON",
  expired: "EXPIRY_STATUS_EXPIRED",
} as const;
const docExpiry = z.enum(["valid", "expiring_soon", "expired"]);

const DOC_APPROVAL_API = {
  pending: "APPROVAL_STATUS_PENDING",
  approved: "APPROVAL_STATUS_APPROVED",
  rejected: "APPROVAL_STATUS_REJECTED",
} as const;

const shortStatus = (s?: string) => s?.replace("CONTRACTOR_COMPANY_STATUS_", "").toLowerCase() ?? s;
const shortExpiry = (s?: string) => s?.replace("EXPIRY_STATUS_", "").toLowerCase() ?? s;
const shortApproval = (s?: string) => s?.replace("APPROVAL_STATUS_", "").toLowerCase() ?? s;
const shortRole = (s?: string) => s?.replace("CONTRACTOR_COMPANY_ROLE_", "").toLowerCase() ?? s;

interface DateParts {
  year?: number;
  month?: number;
  day?: number;
}

/**
 * The API uses {year, month, day} structs with 0 for "unspecified": only full dates convert.
 * Emitted as full ISO date-times: bare YYYY-MM-DD strings would be masked as phone
 * numbers by the output PII sanitizer (src/security/redact.ts).
 */
function isoDateTime(d?: DateParts | null): string | undefined {
  if (!d || !d.year || !d.month || !d.day) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}T00:00:00Z`;
}

const daysUntil = (iso: string, now: Date) => Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000);

interface RawCompany {
  company_id: string;
  attributes?: {
    name?: string;
    status?: string;
    contact_details?: { email?: string; phone_number?: string };
    compliance_statistics?: { expired_document_count?: number; expiring_soon_document_count?: number; pending_approval_document_count?: number };
    user_credential_compliance_statistics?: {
      expired_user_credential_count?: number;
      expiring_soon_user_credential_count?: number;
      pending_approval_user_credential_count?: number;
      total_user_credential_count?: number;
    };
    linked_sites?: Array<{ site_id?: string; site_name?: string }>;
    outstanding_document_request_count?: number;
  };
  company_type?: { id?: string; name?: string };
}

function projectCompany(c: RawCompany) {
  const a = c.attributes ?? {};
  const cs = a.compliance_statistics ?? {};
  const us = a.user_credential_compliance_statistics ?? {};
  return {
    id: c.company_id,
    name: a.name,
    type: c.company_type?.name ? { id: c.company_type.id, name: c.company_type.name } : undefined,
    status: shortStatus(a.status),
    metrics: {
      expired_documents: cs.expired_document_count ?? 0,
      expiring_soon_documents: cs.expiring_soon_document_count ?? 0,
      pending_approval_documents: cs.pending_approval_document_count ?? 0,
      expired_credentials: us.expired_user_credential_count ?? 0,
      expiring_soon_credentials: us.expiring_soon_user_credential_count ?? 0,
      pending_approval_credentials: us.pending_approval_user_credential_count ?? 0,
      total_credentials: us.total_user_credential_count ?? 0,
    },
    sites: (a.linked_sites ?? []).map((s) => ({ id: s.site_id, name: s.site_name })),
    outstanding_document_requests: a.outstanding_document_request_count ?? 0,
  };
}

interface RawCompanyDoc {
  id?: string;
  title?: string;
  approval_status?: string;
  doc_expiry_status?: string;
  expiration_date?: DateParts;
  company_document_type?: { id?: string; name?: string };
}

function projectCompanyDoc(d: RawCompanyDoc, now: Date) {
  const expiry = isoDateTime(d.expiration_date);
  return {
    id: d.id,
    title: d.title,
    type: d.company_document_type?.name,
    approval_status: shortApproval(d.approval_status),
    expiry_status: shortExpiry(d.doc_expiry_status),
    expiry_date: expiry,
    days_until_expiry: expiry === undefined ? undefined : daysUntil(expiry, now),
  };
}

interface RawCredential {
  document_id?: string;
  subject_user?: { id?: string; first_name?: string; last_name?: string };
  document_type?: { id?: string; name?: string };
  attributes?: { expiry_period_end_date?: DateParts };
  metadata?: { expiry_status?: string };
}

function projectCredential(c: RawCredential, now: Date) {
  const expiry = isoDateTime(c.attributes?.expiry_period_end_date);
  const days = expiry === undefined ? undefined : daysUntil(expiry, now);
  const status = expiry === undefined ? "no_expiry" : (shortExpiry(c.metadata?.expiry_status) ?? (days !== undefined && days < 0 ? "expired" : "valid"));
  const name = [c.subject_user?.first_name, c.subject_user?.last_name].filter(Boolean).join(" ") || undefined;
  return {
    id: c.document_id,
    person: name,
    user_id: c.subject_user?.id,
    credential_type: c.document_type?.name,
    expiry_date: expiry,
    days_until_expiry: days,
    status,
  };
}

export const contractorsTools = [
  defineTool({
    name: "sc_list_companies",
    title: "List contractor companies",
    toolset: "contractors",
    access: "read",
    description:
      "Lists contractor companies with their type and compliance metrics (expired/expiring/pending documents and credentials). Filter by name search, company type or status.",
    input: {
      search: z.string().optional().describe("Text to match against the company name."),
      company_type_ids: z.array(z.string()).optional().describe("Only companies of these type IDs."),
      status: z.array(companyStatus).optional().describe("Only companies with these statuses. Default: all statuses."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        contractor_company_list?: RawCompany[];
        total_count?: number;
        next_page_token?: string;
      }>("/companies/v1/companies", {
        filter: {
          search: a.search,
          company_type_ids: a.company_type_ids,
          contractor_company_statuses: a.status?.map((s) => COMPANY_STATUS_API[s]),
        },
        page_size: a.limit ?? 50,
        page_token: a.page_token,
        include_user_credential_compliance_stats: true,
      });
      const rows = (res.contractor_company_list ?? []).map(projectCompany);
      return {
        summary: `${res.total_count ?? rows.length} contractor companies match; showing ${rows.length}.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { total: res.total_count, companies: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_company",
    title: "Get contractor company",
    toolset: "contractors",
    access: "read",
    description:
      "Gets one contractor company in full: contact details, type, status, compliance metrics and linked sites, plus its users (name and company role) and a documents summary with totals.",
    input: {
      company_id: z.string().describe("Contractor company ID."),
    },
    run: async ({ company_id }, ctx) => {
      const [company, users, docs] = await Promise.all([
        ctx.client.get<{ contractor_company?: RawCompany }>("/companies/v1/company", {
          company_id,
          include_user_credential_compliance_stats: true,
        }),
        ctx.client.post<{
          company_user_metadata_list?: Array<{ user_doc?: { id?: string; first_name?: string; last_name?: string }; role?: string }>;
          next_page_token?: string;
        }>("/companies/v1/users", { company_id, page_size: 50 }),
        ctx.client.post<{ company_document_list?: RawCompanyDoc[]; total_count?: number }>("/companies/v1/documents", {
          company_id,
          page_size: 5,
        }),
      ]);
      const c = company.contractor_company;
      if (!c) throw new Error(`Company ${company_id} was not found.`);
      const detail = projectCompany(c);
      const userRows = (users.company_user_metadata_list ?? []).map((u) => ({
        id: u.user_doc?.id,
        name: [u.user_doc?.first_name, u.user_doc?.last_name].filter(Boolean).join(" ") || undefined,
        role: shortRole(u.role),
      }));
      const docList = docs.company_document_list ?? [];
      return {
        summary: `"${detail.name}" (${detail.status ?? "unknown status"}) has ${userRows.length} listed users and ${docs.total_count ?? docList.length} documents.`,
        data: {
          ...detail,
          contact: c.attributes?.contact_details
            ? { email: c.attributes.contact_details.email, phone: c.attributes.contact_details.phone_number }
            : undefined,
          users: userRows,
          users_have_more: Boolean(users.next_page_token),
          documents_summary: {
            total: docs.total_count,
            sample: docList.map((d) => projectCompanyDoc(d, ctx.now())),
          },
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_company_documents",
    title: "List company documents",
    toolset: "contractors",
    access: "read",
    description:
      "Lists a contractor company's documents with type, approval status and expiry (expiry date plus days until expiry). Filter by expiry or approval status to find documents needing attention.",
    input: {
      company_id: z.string().describe("Contractor company ID."),
      expiry: z.array(docExpiry).optional().describe("Only documents with these expiry states. Default: all."),
      approval: z.array(z.enum(["pending", "approved", "rejected"])).optional().describe("Only documents with these approval states. Default: all."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ company_document_list?: RawCompanyDoc[]; total_count?: number; next_page_token?: string }>(
        "/companies/v1/documents",
        {
          company_id: a.company_id,
          filter: {
            doc_expiry_statuses: a.expiry?.map((e) => DOC_EXPIRY_API[e]),
            approval_statuses: a.approval?.map((s) => DOC_APPROVAL_API[s]),
          },
          page_size: a.limit ?? 50,
          page_token: a.page_token,
        },
      );
      const rows = (res.company_document_list ?? []).map((d) => projectCompanyDoc(d, ctx.now()));
      return {
        summary: `${res.total_count ?? rows.length} documents for company ${a.company_id}; showing ${rows.length}.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { total: res.total_count, documents: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_credential_types",
    title: "List credential types",
    toolset: "contractors",
    access: "read",
    description:
      "Lists the credential (licence/ticket) types defined in this organisation, with category and usage counts. Call before filtering sc_list_credentials by type.",
    input: {
      search: z.string().optional().describe("Text to match against the type name."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        types_list?: Array<{ id?: string; name?: string; description?: string; type_category?: string; stats?: { mapping_count?: number } }>;
        next_page_token?: string;
      }>("/credentials/v1/credential-types", {
        document_category: "DOCUMENT_CATEGORY_LICENSES_AND_CREDENTIALS",
        include_global: true,
        type_criteria: {
          filter: a.search ? { search: a.search } : undefined,
          page_size: a.limit ?? 50,
          page_token: a.page_token,
        },
      });
      const rows = (res.types_list ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.type_category?.replace("TYPE_CATEGORY_", "").toLowerCase(),
        mapping_count: t.stats?.mapping_count,
      }));
      return {
        summary: `${rows.length} credential types.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { credential_types: rows, next_page_token: res.next_page_token || undefined },
      };
    },
  }),

  defineTool({
    name: "sc_list_credentials",
    title: "List credentials",
    toolset: "contractors",
    access: "read",
    description:
      "Lists the latest version of each credential (licence/ticket) with person, credential type, expiry date, days until expiry and status. Filter by user, credential type, a period like \"next 30 days\", or expired only.",
    input: {
      user_id: z.string().optional().describe("Only credentials belonging to this user (user_...)."),
      credential_type_id: z.string().optional().describe("Only credentials of this type. Use sc_list_credential_types to find it."),
      expiring_within: z
        .string()
        .optional()
        .describe('Only credentials expiring within this period, e.g. "next 30 days". Uses the expiry date, not the API\'s expiring-soon flag.'),
      expired: z.boolean().optional().describe("Pass true to return only expired credentials."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const period = a.expiring_within ? parsePeriod(a.expiring_within, ctx.now()) : undefined;
      const filter: Record<string, unknown> = {};
      if (a.user_id) filter.user_id = { values: [ids.uuid(a.user_id)] };
      if (a.credential_type_id) filter.document_type_id = { values: [a.credential_type_id] };
      if (a.expired) filter.expiry_status = { values: ["EXPIRY_STATUS_EXPIRED"] };
      else if (period) filter.expiry_status = { values: ["EXPIRY_STATUS_VALID", "EXPIRY_STATUS_EXPIRING_SOON"] };
      const res = await ctx.client.post<{
        latest_document_versions?: RawCredential[];
        total_count?: number;
        next_page_token?: string;
      }>("/credentials/v1/credentials", {
        page_size: a.limit ?? 50,
        page_token: a.page_token,
        ...(Object.keys(filter).length ? { document_version_filters: [filter] } : {}),
        document_version_sort_field: "DOCUMENT_VERSION_SORT_FIELD_EXPIRY",
        sort_direction: "SORT_DIRECTION_ASC",
      });
      let rows = (res.latest_document_versions ?? []).map((c) => projectCredential(c, ctx.now()));
      if (a.expired) rows = rows.filter((r) => r.status === "expired");
      if (period) rows = rows.filter((r) => r.expiry_date !== undefined && inPeriod(r.expiry_date, period));
      const when = a.expired ? "expired" : period ? `expiring ${period.label}` : "matching";
      return {
        summary: `${rows.length} credentials ${when} shown${res.total_count !== undefined ? ` (${res.total_count} match server-side).` : "."}`,
        data: { total: res.total_count, credentials: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),
];
