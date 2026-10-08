import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PiiLevel } from "../core/config.js";
import { redactSecrets, sanitize } from "./redact.js";

export interface AuditEntry {
  tool: string;
  access: "write" | "destructive";
  phase: "planned" | "executed" | "failed";
  args: unknown;
  result?: unknown;
  error?: string;
}

/** Append-only JSONL log of every write the server performs (or plans). Local file, never uploaded. */
export class AuditLog {
  private ready: Promise<void> | undefined;
  constructor(
    private readonly path: string,
    private readonly pii: PiiLevel = "contact",
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      this.ready ??= mkdir(dirname(this.path), { recursive: true }).then(() => undefined);
      await this.ready;
      // Same privacy policy as tool output, applied to the structure before serialising.
      const line = redactSecrets(JSON.stringify(sanitize({ ts: new Date().toISOString(), ...entry }, this.pii)));
      await appendFile(this.path, line + "\n", { encoding: "utf8", mode: 0o600 });
    } catch {
      // Audit failures must never break the tool call, but they are reported on stderr.
      process.stderr.write(`[safetyculture-mcp] could not write audit log at ${this.path}\n`);
    }
  }
}
