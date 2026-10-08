import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures synthetic: no real organisation data.
const company = (id: string) => ({
  company_id: id,
  attributes: {
    name: `Demo Contractor ${id}`,
    status: "CONTRACTOR_COMPANY_STATUS_ACTIVE",
    compliance_statistics: { expired_document_count: 1, expiring_soon_document_count: 2, pending_approval_document_count: 0 },
    user_credential_compliance_statistics: {
      expired_user_credential_count: 0,
      expiring_soon_user_credential_count: 1,
      pending_approval_user_credential_count: 0,
      total_user_credential_count: 4,
    },
    linked_sites: [{ site_id: "site-1", site_name: "Demo Depot" }],
    outstanding_document_request_count: 0,
  },
  company_type: { id: "type-1", name: "Electrical" },
});

const parts = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000);

const credential = (id: string, end: { year: number; month: number; day: number }, status: string) => ({
  document_id: id,
  subject_user: { id: "11111111-1111-4111-8111-111111111111", first_name: "Alex", last_name: "Demo" },
  document_type: { id: "credtype-1", name: "Demo Licence" },
  attributes: { expiry_period_end_date: end },
  metadata: { expiry_status: status },
});

describe("contractors toolset", () => {
  it("lists companies as compact rows with type and metrics", async () => {
    const api = new MockApi().on("POST /companies/v1/companies", {
      contractor_company_list: [company("comp-1"), company("comp-2")],
      total_count: 2,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_companies", { search: "Demo", status: ["active"] });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/companies/v1/companies",
      body: {
        filter: { search: "Demo", contractor_company_statuses: ["CONTRACTOR_COMPANY_STATUS_ACTIVE"] },
        page_size: 50,
        include_user_credential_compliance_stats: true,
      },
    });
    const data = json(res.text);
    expect(data.companies[0]).toMatchObject({
      id: "comp-1",
      name: "Demo Contractor comp-1",
      type: { id: "type-1", name: "Electrical" },
      status: "active",
      metrics: { expired_documents: 1, expiring_soon_documents: 2, total_credentials: 4 },
    });
    expect(data.total).toBe(2);
  });

  it("gets one company with users and a documents summary", async () => {
    const api = new MockApi()
      .on("GET /companies/v1/company", { contractor_company: company("comp-1") })
      .on("POST /companies/v1/users", {
        company_user_metadata_list: [
          { user_doc: { id: "user-1", first_name: "Alex", last_name: "Demo" }, role: "CONTRACTOR_COMPANY_ROLE_MEMBER" },
        ],
      })
      .on("POST /companies/v1/documents", {
        company_document_list: [
          {
            id: "doc-1",
            title: "Demo Insurance",
            approval_status: "APPROVAL_STATUS_APPROVED",
            doc_expiry_status: "EXPIRY_STATUS_VALID",
            expiration_date: { year: 2099, month: 12, day: 31 },
            company_document_type: { id: "dt-1", name: "Insurance" },
          },
        ],
        total_count: 7,
      });
    const { call, json } = await connect(api);
    const res = await call("sc_get_company", { company_id: "comp-1" });
    expect(res.isError).toBe(false);
    expect(api.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(
      ["GET /companies/v1/company", "POST /companies/v1/documents", "POST /companies/v1/users"].sort(),
    );
    expect(api.calls.find((c) => c.method === "GET")!.query).toMatchObject({ company_id: "comp-1" });
    const data = json(res.text);
    expect(data.users).toEqual([{ id: "user-1", name: "Alex Demo", role: "member" }]);
    expect(data.documents_summary.total).toBe(7);
    expect(data.documents_summary.sample[0]).toMatchObject({ id: "doc-1", expiry_status: "valid", expiry_date: "2099-12-31T00:00:00Z" });
    expect(data.documents_summary.sample[0].days_until_expiry).toBeGreaterThan(0);
  });

  it("lists company documents with expiry projection and status filters", async () => {
    const api = new MockApi().on("POST /companies/v1/documents", {
      company_document_list: [
        {
          id: "doc-9",
          title: "Old Certificate",
          approval_status: "APPROVAL_STATUS_APPROVED",
          doc_expiry_status: "EXPIRY_STATUS_EXPIRED",
          expiration_date: { year: 2001, month: 1, day: 15 },
          company_document_type: { id: "dt-2", name: "Certificate" },
        },
      ],
      total_count: 1,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_company_documents", { company_id: "comp-1", expiry: ["expired"] });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toMatchObject({
      company_id: "comp-1",
      filter: { doc_expiry_statuses: ["EXPIRY_STATUS_EXPIRED"] },
      page_size: 50,
    });
    const data = json(res.text);
    expect(data.documents[0]).toMatchObject({
      id: "doc-9",
      expiry_status: "expired",
      expiry_date: "2001-01-15T00:00:00Z",
    });
    expect(data.documents[0].days_until_expiry).toBeLessThan(0);
  });

  it("lists credential types with the documented category", async () => {
    const api = new MockApi().on("POST /credentials/v1/credential-types", {
      types_list: [{ id: "credtype-1", name: "Demo Licence", description: "Demo only", type_category: "TYPE_CATEGORY_CUSTOM", stats: { mapping_count: 3 } }],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_credential_types", { search: "Licence" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/credentials/v1/credential-types",
      body: {
        document_category: "DOCUMENT_CATEGORY_LICENSES_AND_CREDENTIALS",
        type_criteria: { filter: { search: "Licence" }, page_size: 50 },
      },
    });
    expect(json(res.text).credential_types).toEqual([
      { id: "credtype-1", name: "Demo Licence", description: "Demo only", category: "custom", mapping_count: 3 },
    ]);
  });

  it("lists credentials filtered to an expiry window parsed with parsePeriod", async () => {
    const api = new MockApi().on("POST /credentials/v1/credentials", {
      latest_document_versions: [
        credential("cred-soon", parts(plusDays(10)), "EXPIRY_STATUS_EXPIRING_SOON"),
        credential("cred-late", parts(plusDays(200)), "EXPIRY_STATUS_VALID"),
      ],
      total_count: 2,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_credentials", {
      user_id: "11111111-1111-4111-8111-111111111111",
      credential_type_id: "credtype-1",
      expiring_within: "next 30 days",
    });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toMatchObject({
      page_size: 50,
      document_version_filters: [
        {
          user_id: { values: ["11111111-1111-4111-8111-111111111111"] },
          document_type_id: { values: ["credtype-1"] },
          expiry_status: { values: ["EXPIRY_STATUS_VALID", "EXPIRY_STATUS_EXPIRING_SOON"] },
        },
      ],
      document_version_sort_field: "DOCUMENT_VERSION_SORT_FIELD_EXPIRY",
    });
    const data = json(res.text);
    expect(data.credentials.map((c: { id: string }) => c.id)).toEqual(["cred-soon"]);
    expect(data.credentials[0]).toMatchObject({ person: "Alex Demo", credential_type: "Demo Licence", status: "expiring_soon" });
    expect(data.credentials[0].days_until_expiry).toBeGreaterThan(0);
  });

  it("lists only expired credentials when expired is set", async () => {
    const api = new MockApi().on("POST /credentials/v1/credentials", {
      latest_document_versions: [
        credential("cred-old", { year: 2001, month: 1, day: 15 }, "EXPIRY_STATUS_EXPIRED"),
        credential("cred-ok", parts(plusDays(200)), "EXPIRY_STATUS_VALID"),
      ],
      total_count: 2,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_credentials", { expired: true });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toMatchObject({
      document_version_filters: [{ expiry_status: { values: ["EXPIRY_STATUS_EXPIRED"] } }],
    });
    const data = json(res.text);
    expect(data.credentials.map((c: { id: string }) => c.id)).toEqual(["cred-old"]);
    expect(data.credentials[0].days_until_expiry).toBeLessThan(0);
  });
});
