import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures synthetic: no real organisation data.
const folder = { folder_id: "folder-1", name: "Demo Folder", modified_at: "2026-09-01T00:00:00Z", child_count: 2, ancestors: [] };
const file = {
  file_id: "file-1",
  name: "Demo Evacuation Plan",
  description: "Demo only",
  file_extension: "pdf",
  file_size: 1234,
  modified_at: "2026-09-02T00:00:00Z",
  expiry_status: "EXPIRY_STATUS_VALID",
  valid_to: { year: 2099, month: 6, day: 30 },
  ancestors: [{ folder_id: "folder-1", name: "Demo Folder" }],
};

describe("documents toolset", () => {
  it("searches files and folders by name with paths", async () => {
    const api = new MockApi().on("POST /documents/v1/search", { folders: [folder], files: [file], total: 2 });
    const { call, json } = await connect(api);
    const res = await call("sc_search_documents", { query: "Evacuation" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/documents/v1/search",
      body: { search_term: "Evacuation", page_size: 50 },
    });
    const data = json(res.text);
    expect(data.folders).toEqual([{ kind: "folder", id: "folder-1", name: "Demo Folder", path: undefined, child_count: 2, modified_at: "2026-09-01T00:00:00Z" }]);
    expect(data.files).toEqual([
      {
        kind: "file",
        id: "file-1",
        name: "Demo Evacuation Plan",
        extension: "pdf",
        size: 1234,
        path: "Demo Folder",
        expiry_status: "valid",
        valid_to: "2099-06-30T00:00:00Z",
        modified_at: "2026-09-02T00:00:00Z",
      },
    ]);
  });

  it("lists folder items and requires a folder id (the live API has no root listing)", async () => {
    const api = new MockApi().on("POST /documents/v1/children", { folders: [], files: [file], total: 1 });
    const { call, json } = await connect(api);
    const res = await call("sc_list_folder_items", { folder_id: "folder-1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/documents/v1/children",
      body: { parent_id: "folder-1", page_size: 50 },
    });
    expect(json(res.text).files).toHaveLength(1);

    const api2 = new MockApi().on("POST /documents/v1/children", { folders: [folder], files: [], total: 1 });
    const second = await connect(api2);
    const root = await second.call("sc_list_folder_items", {});
    expect(root.isError).toBe(true);
    expect(api2.calls).toHaveLength(0);
  });
});
