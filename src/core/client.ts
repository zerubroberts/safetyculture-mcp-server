import type { Config } from "./config.js";
import { ScApiError } from "./errors.js";

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Override the default: only idempotent methods are retried on 5xx. 429 is always retried. */
  retry?: boolean;
  /** Return the raw Response (for binary downloads). */
  raw?: boolean;
}

export interface FeedPage<T> {
  data: T[];
  metadata?: { next_page?: string | null; remaining_records?: number };
}

export interface CollectOptions {
  maxItems?: number;
  maxPages?: number;
}

export interface Collected<T> {
  items: T[];
  truncated: boolean;
  pages: number;
  /** Set when the API returned a repeating page token (a known upstream defect on some feeds). */
  stuck?: boolean;
}

type Fetch = typeof fetch;

/**
 * Small, dependency-free client for the Mitti (SafetyCulture) public API.
 * - Bearer auth; the token never appears in errors or logs.
 * - Client-side rate limit (token bucket) plus retry with backoff on 429 / 5xx,
 *   honouring Retry-After and x-ratelimit-reset (seconds).
 * - Helpers for the three pagination styles the API uses.
 */
export class ScClient {
  private tokens: number;
  private last = Date.now();
  private readonly fetchImpl: Fetch;

  constructor(
    private readonly cfg: Pick<Config, "apiToken" | "baseUrl" | "requestsPerSecond" | "timeoutMs" | "maxRetries" | "integrationId">,
    fetchImpl?: Fetch,
  ) {
    this.tokens = cfg.requestsPerSecond;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get<T = unknown>(path: string, query?: Query, opts: Omit<RequestOptions, "query"> = {}) {
    return this.request<T>("GET", path, { ...opts, query });
  }
  post<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("POST", path, { ...opts, body });
  }
  put<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("PUT", path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("DELETE", path, opts);
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.query);
    const idempotent = method === "GET" || method === "PUT" || method === "DELETE";
    const retryable5xx = opts.retry ?? idempotent;
    let attempt = 0;

    for (;;) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.cfg.apiToken}`,
            Accept: "application/json",
            "sc-integration-id": this.cfg.integrationId,
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal ?? AbortSignal.timeout(this.cfg.timeoutMs),
        });
      } catch (err) {
        if (attempt < this.cfg.maxRetries && retryable5xx) {
          await sleep(backoff(attempt++));
          continue;
        }
        throw new ScApiError(0, method, path, err instanceof Error ? err.message : String(err));
      }

      if (res.ok) {
        if (opts.raw) return res as unknown as T;
        if (res.status === 204) return {} as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const shouldRetry = res.status === 429 || (res.status >= 500 && retryable5xx);
      if (shouldRetry && attempt < this.cfg.maxRetries) {
        await sleep(retryDelay(res, attempt++));
        continue;
      }
      throw new ScApiError(res.status, method, path, await res.text().catch(() => ""));
    }
  }

  /**
   * Follows a Data Feed (`/feed/*`). The API returns `metadata.next_page` as a relative path that
   * already carries the cursor; it is followed exactly as given.
   */
  async collectFeed<T = Record<string, unknown>>(path: string, query: Query = {}, opts: CollectOptions = {}): Promise<Collected<T>> {
    const maxItems = opts.maxItems ?? 5000;
    const maxPages = opts.maxPages ?? 200;
    const items: T[] = [];
    const seen = new Set<string>();
    let next: string | null | undefined = this.url(path, query).slice(this.cfg.baseUrl.length);
    let pages = 0;
    while (next && pages < maxPages && items.length < maxItems) {
      if (seen.has(next)) return { items, truncated: true, pages, stuck: true };
      seen.add(next);
      const page: FeedPage<T> = await this.get<FeedPage<T>>(next);
      pages++;
      items.push(...(page.data ?? []));
      next = page.metadata?.next_page;
    }
    const truncated = Boolean(next) || items.length > maxItems;
    return { items: items.slice(0, maxItems), truncated, pages };
  }

  /** Generic page-token pagination (`page_token` / `next_page_token`). */
  async collectPages<T>(
    fetchPage: (pageToken: string | undefined) => Promise<{ items: T[]; next?: string | null }>,
    opts: CollectOptions = {},
  ): Promise<Collected<T>> {
    const maxItems = opts.maxItems ?? 2000;
    const maxPages = opts.maxPages ?? 100;
    const items: T[] = [];
    const seen = new Set<string>();
    let token: string | undefined;
    let pages = 0;
    for (;;) {
      const { items: batch, next } = await fetchPage(token);
      pages++;
      items.push(...batch);
      if (!next || items.length >= maxItems || pages >= maxPages) {
        return { items: items.slice(0, maxItems), truncated: Boolean(next) || items.length > maxItems, pages };
      }
      if (seen.has(next)) return { items, truncated: true, pages, stuck: true };
      seen.add(next);
      token = next;
    }
  }

  url(path: string, query?: Query): string {
    const u = new URL(path.startsWith("http") ? path : `${this.cfg.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
    if (u.origin !== new URL(this.cfg.baseUrl).origin) {
      // A next_page link or caller path must never redirect the bearer token to another host.
      throw new ScApiError(0, "GET", path, "Refusing to send credentials to a host other than the configured API base URL.");
    }
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
      else u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async throttle(): Promise<void> {
    const rate = Math.max(0.5, this.cfg.requestsPerSecond);
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(rate, this.tokens + ((now - this.last) / 1000) * rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / rate) * 1000));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

function retryDelay(res: Response, attempt: number): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(60_000, Number(retryAfter) * 1000);
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const n = Number(reset);
    // Either an epoch timestamp in seconds or a seconds-until-reset count.
    const ms = n > 1e9 ? n * 1000 - Date.now() : n * 1000;
    if (ms > 0) return Math.min(60_000, ms + 100);
  }
  return backoff(attempt);
}
