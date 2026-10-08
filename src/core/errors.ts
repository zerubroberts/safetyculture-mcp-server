import { redactSecrets } from "../security/redact.js";

export class ScApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    // The upstream body is never part of .message: messages get copied into result data, cache
    // status and logs, and a body can quote record text or names. Use fullMessage where the
    // privacy policy allows the API's own words to be shown.
    super(ScApiError.describe(status, method, path, status === 0 ? body : "")); // status 0 = local error (network, host pin): our own text
    this.name = "ScApiError";
  }

  /** The message plus the API's own reply (secrets redacted, cut to 600 characters). */
  get fullMessage(): string {
    return ScApiError.describe(this.status, this.method, this.path, this.body);
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
                  : status >= 200 && status < 300
                    ? "The reply was not valid JSON (often a maintenance page). Usually temporary."
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
