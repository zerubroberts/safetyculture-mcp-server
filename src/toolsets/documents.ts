import { z } from "zod";
import { P } from "../core/params.js";
import { defineTool } from "../core/registry.js";

/**
 * Documents library: files and folders.
 * Contracts verified against the cached API reference 2026-10-08
 * (documentspublicservice_searchitems, documentspublicservice_getfolderchildren).
 */

interface RawFolder {
  folder_id?: string;
  name?: string;
  modified_at?: string;
  child_count?: number;
  ancestors?: Array<{ folder_id?: string; name?: string }>;
}

interface RawFile {
  file_id?: string;
  name?: string;
  description?: string;
  file_extension?: string;
  file_size?: number;
  modified_at?: string;
  expiry_status?: string;
  valid_to?: { year?: number; month?: number; day?: number };
  ancestors?: Array<{ folder_id?: string; name?: string }>;
}

const pathOf = (ancestors?: Array<{ name?: string }>) => (ancestors ?? []).map((a) => a.name).filter(Boolean).join(" / ") || undefined;

const shortExpiry = (s?: string) => s?.replace("EXPIRY_STATUS_", "").toLowerCase() ?? s;

function projectFolder(f: RawFolder) {
  return {
    kind: "folder" as const,
    id: f.folder_id,
    name: f.name,
    path: pathOf(f.ancestors),
    child_count: f.child_count,
    modified_at: f.modified_at,
  };
}

function projectFile(f: RawFile) {
  const v = f.valid_to;
  // Full ISO date-time: a bare YYYY-MM-DD would be masked as a phone number by the output PII sanitizer.
  const validTo = v?.year && v.month && v.day ? `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}T00:00:00Z` : undefined;
  return {
    kind: "file" as const,
    id: f.file_id,
    name: f.name,
    extension: f.file_extension,
    size: f.file_size,
    path: pathOf(f.ancestors),
    expiry_status: shortExpiry(f.expiry_status),
    valid_to: validTo,
    modified_at: f.modified_at,
  };
}

interface DocList {
  folders?: RawFolder[];
  files?: RawFile[];
  total?: number;
  next_page_token?: string;
}

const shape = (res: DocList) => ({
  total: res.total,
  folders: (res.folders ?? []).map(projectFolder),
  files: (res.files ?? []).map(projectFile),
  next_page_token: res.next_page_token || undefined,
});

export const documentsTools = [
  defineTool({
    name: "sc_search_documents",
    title: "Search documents",
    toolset: "documents",
    access: "read",
    description:
      "Searches the Documents library for files and folders by name. Returns compact rows with folder path, file size, validity dates and expiry status.",
    input: {
      query: z.string().min(1).max(200).describe("Text to match against file or folder names."),
      archived: z.boolean().optional().describe("Pass true to search only archived items. Default: unarchived only."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<DocList>("/documents/v1/search", {
        search_term: a.query,
        archived: a.archived,
        page_size: a.limit ?? 50,
        page_token: a.page_token,
      });
      const data = shape(res);
      return {
        summary: `${data.total ?? data.folders.length + data.files.length} items match "${a.query}" (${data.folders.length} folders, ${data.files.length} files).${data.next_page_token ? " More available: pass next_page_token." : ""}`,
        data,
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_folder_items",
    title: "List folder items",
    toolset: "documents",
    access: "read",
    description:
      "Lists the files and folders inside one Documents folder (the API has no root listing: find top-level folders with sc_search_documents first). Returns compact rows with folder path, file size, validity dates and expiry status.",
    input: {
      folder_id: z.string().min(1).describe("Folder ID to list (from sc_search_documents or a previous listing)."),
      archived: z.boolean().optional().describe("Pass true to list only archived items. Default: unarchived only."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<DocList>("/documents/v1/children", {
        parent_id: a.folder_id,
        archived: a.archived,
        page_size: a.limit ?? 50,
        page_token: a.page_token,
      });
      const data = shape(res);
      const where = `Folder ${a.folder_id}`;
      return {
        summary: `${where} holds ${data.total ?? data.folders.length + data.files.length} items (${data.folders.length} folders, ${data.files.length} files).${data.next_page_token ? " More available: pass next_page_token." : ""}`,
        data,
        untrusted: true,
      };
    },
  }),
];
