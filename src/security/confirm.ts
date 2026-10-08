import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_FORMAT = /^([1-9]\d{0,15})\.([A-Za-z0-9_-]{43})$/;

// Consumed signatures, shared by every ConfirmTokens instance in the process. The HTTP transport
// builds a fresh server (and registry) per request, so a per-instance list would let a token be
// replayed once per request.
const consumed = new Map<string, number>();

/**
 * Two-step confirmation for destructive tools.
 *
 * Call 1 (no confirm_token): the tool returns a dry-run plan plus a token bound to the exact
 * tool name and arguments. Call 2 (same args + token): the action runs. Changing any argument
 * invalidates the token, tokens expire after `ttlMs`, and each token works exactly once.
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

  /** Verifies and consumes the token. Any deviation from the exact issued string fails. */
  verify(tool: string, args: unknown, token: string, now = Date.now()): boolean {
    const m = TOKEN_FORMAT.exec(token);
    if (!m) return false;
    const exp = Number(m[1]);
    const sig = m[2]!;
    if (exp < now || consumed.has(sig)) return false;
    const expected = Buffer.from(this.sign(tool, args, exp));
    const got = Buffer.from(sig);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
    consumed.set(sig, exp);
    for (const [s, e] of consumed) if (e < now) consumed.delete(s);
    return true;
  }

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
