import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Two-step confirmation for destructive tools.
 *
 * Call 1 (no confirm_token): the tool returns a dry-run plan plus a token bound to the exact
 * tool name and arguments. Call 2 (same args + token): the action runs. Changing any argument
 * invalidates the token, and tokens expire after `ttlMs`.
 */
export class ConfirmTokens {
  constructor(
    private readonly secret: string,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  issue(tool: string, args: unknown, now = Date.now()): string {
    const exp = now + this.ttlMs;
    return `${exp}.${this.sign(tool, args, exp)}`;
  }

  /** Verifies and consumes the token: a confirm token works exactly once. */
  verify(tool: string, args: unknown, token: string, now = Date.now()): boolean {
    const [expStr, sig] = token.split(".");
    const exp = Number(expStr);
    if (!sig || !Number.isFinite(exp) || exp < now || this.used.has(token)) return false;
    const expected = Buffer.from(this.sign(tool, args, exp));
    const got = Buffer.from(sig);
    const ok = expected.length === got.length && timingSafeEqual(expected, got);
    if (ok) {
      this.used.set(token, exp);
      for (const [t, e] of this.used) if (e < now) this.used.delete(t);
    }
    return ok;
  }

  private readonly used = new Map<string, number>();

  private sign(tool: string, args: unknown, exp: number): string {
    return createHmac("sha256", this.secret).update(`${tool}|${exp}|${canonical(args)}`).digest("base64url");
  }
}

/** Stable JSON: object keys sorted, so {a,b} and {b,a} produce the same token. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
