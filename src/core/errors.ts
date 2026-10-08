import { redactSecrets } from "../security/redact.js";

export class ScApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(ScApiError.describe(status, method, path, body));
    this.name = "ScApiError";
  }

  /** The same message without the upstream body (used at SC_PII=strict, where bodies can quote names). */
  get withoutBody(): string {
    return ScApiError.describe(this.status, this.method, this.path, "");
  }

  static describe(status: number, method: string, path: string, body: string): string {
    const hint =
      status === 401
        ? "The API token is missing, expired or revoked. Create a new one in Mitti > Settings > Integrations > API tokens."
        : status === 403
          ? "The token's user lacks permission for this resource. API tokens act with the permissions of the user who created them."
          : status === 404
            ? "Not found, or the token's user cannot see it. Check the ID (inspection IDs start with audit_, templates with template_)."
            : status === 429
              ? "Rate limited by the Mitti API after retries. Narrow the query or try again shortly."
              : status === 400
                ? "The API rejected the request. The message below usually says which field is wrong."
                : status >= 500
                  ? "Mitti API server error. Usually temporary."
                  : "";
    const snippet = redactSecrets(body).slice(0, 600);
    return `Mitti API ${status} on ${method} ${path.split("?")[0]}. ${hint}${snippet ? ` API said: ${snippet}` : ""}`;
  }
}

/** Errors raised by tools for bad input or unsafe requests; message is shown to the model verbatim. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
