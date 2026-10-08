import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * Access modes, from safest to most powerful.
 * - read-only: only tools that never change data are registered (default).
 * - write: also registers tools that create or update records.
 * - full: also registers destructive tools (delete, archive, bulk changes). These still need a
 *   two-step dry-run + confirm token on every call.
 */
export const MODES = ["read-only", "write", "full"] as const;
export type Mode = (typeof MODES)[number];

/** How much personal data leaves the server in tool outputs. */
export const PII_LEVELS = ["none", "contact", "strict"] as const;
export type PiiLevel = (typeof PII_LEVELS)[number];

export interface Config {
  apiToken: string;
  /** SC_DEMO: serve the synthetic demo organisation (src/demo) instead of calling the API. */
  demo: boolean;
  baseUrl: string;
  mode: Mode;
  toolsets: string[] | "all";
  pii: PiiLevel;
  maxResultChars: number;
  requestsPerSecond: number;
  timeoutMs: number;
  maxRetries: number;
  dataDir: string;
  auditLog: string;
  exportDir: string;
  confirmSecret: string;
  integrationId: string;
  http: {
    host: string;
    port: number;
    bearerToken: string | undefined;
    allowedOrigins: string[];
  };
}

const bool = (v: string | undefined) => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const EnvSchema = z.object({
  token: z.string().min(10, "Set SC_API_TOKEN (or SAFETYCULTURE_API_TOKEN) to a Mitti / SafetyCulture API token."),
  baseUrl: z.string().url().refine((u) => u.startsWith("https://"), "SC_API_BASE_URL must use https://"),
  mode: z.enum(MODES),
  pii: z.enum(PII_LEVELS),
});

export class ConfigError extends Error {}

/**
 * Builds config from environment variables (and CLI overrides already merged into env).
 * Secrets are never echoed back in error messages.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { requireToken?: boolean } = {}): Config {
  const demo = bool(env.SC_DEMO);
  // Demo mode needs no token: a fixed placeholder is sent to the in-process demo API only.
  const token = demo ? "demo-mode-no-token" : (env.SC_API_TOKEN ?? env.SAFETYCULTURE_API_TOKEN ?? env.MITTI_API_TOKEN ?? "");

  // SC_ENABLE_WRITES / SC_ENABLE_DESTRUCTIVE are friendlier aliases for SC_MODE.
  let mode: string = env.SC_MODE ?? "read-only";
  if (!env.SC_MODE) {
    if (bool(env.SC_ENABLE_DESTRUCTIVE)) mode = "full";
    else if (bool(env.SC_ENABLE_WRITES)) mode = "write";
  }

  const parsed = EnvSchema.safeParse({
    token: opts.requireToken === false && !token ? "placeholder-token" : token,
    baseUrl: demo ? "https://demo.safetyculture-mcp.invalid" : (env.SC_API_BASE_URL ?? "https://api.mitti.com"),
    mode,
    pii: env.SC_PII ?? "contact",
  });
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const toolsetsRaw = list(env.SC_TOOLSETS);
  // Demo mode keeps its cache and audit log apart from a real organisation's.
  const dataDir = env.SC_DATA_DIR ?? join(homedir(), ".safetyculture-mcp", ...(demo ? ["demo"] : []));

  return {
    apiToken: parsed.data.token,
    demo,
    baseUrl: parsed.data.baseUrl.replace(/\/+$/, ""),
    mode: parsed.data.mode,
    toolsets: toolsetsRaw.length === 0 ? ["default"] : toolsetsRaw.includes("all") ? "all" : toolsetsRaw,
    pii: parsed.data.pii,
    maxResultChars: Number(env.SC_MAX_RESULT_CHARS ?? 60_000),
    requestsPerSecond: Number(env.SC_REQUESTS_PER_SECOND ?? (demo ? 200 : 8)),
    timeoutMs: Number(env.SC_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(env.SC_MAX_RETRIES ?? 4),
    dataDir,
    auditLog: env.SC_AUDIT_LOG ?? join(dataDir, "audit.jsonl"),
    exportDir: env.SC_EXPORT_DIR ?? join(dataDir, "exports"),
    // Per-process random secret unless pinned: confirm tokens cannot be replayed across restarts.
    confirmSecret: env.SC_CONFIRM_SECRET ?? cryptoRandom(),
    integrationId: env.SC_INTEGRATION_ID ?? "safetyculture-mcp",
    http: {
      host: env.SC_HTTP_HOST ?? "127.0.0.1",
      port: Number(env.SC_HTTP_PORT ?? 8787),
      bearerToken: env.SC_HTTP_BEARER_TOKEN || undefined,
      allowedOrigins: list(env.SC_HTTP_ALLOWED_ORIGINS),
    },
  };
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();
}

export const modeAllows = (mode: Mode, access: "read" | "write" | "destructive") =>
  access === "read" || (access === "write" && mode !== "read-only") || (access === "destructive" && mode === "full");
