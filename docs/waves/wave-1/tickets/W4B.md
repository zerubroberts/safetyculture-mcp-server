# TICKET W4B: Contractors, credentials, documents, sensors and webhooks toolsets

Repo: safetyculture-mcp, an open-source MCP server for Mitti (formerly SafetyCulture). Spec: docs/SPEC.md.

## FILES ALLOWED
src/toolsets/contractors.ts, src/toolsets/documents.ts, src/toolsets/sensors.ts, src/toolsets/webhooks.ts, test/toolsets/contractors.test.ts, test/toolsets/documents.test.ts, test/toolsets/sensors.test.ts, test/toolsets/webhooks.test.ts

## API SECTIONS
docs/api-index.md sections: Companies, Credentials, Documents, Sensors, Webhooks. Run `node scripts/api-ref.mjs <slug>` for every endpoint you call.

## GOAL
In `src/toolsets/contractors.ts` (export `contractorsTools`):
- `sc_list_companies` (read: contractor companies with type and metrics), `sc_get_company` (read: details, users, documents summary), `sc_list_company_documents` (read, with expiry), `sc_list_credential_types` (read).
- `sc_list_credentials` (read): latest credential versions; filters user, type, `expiring_within` (parse with parsePeriod, e.g. "next 30 days"), `expired`; rows person, credential type, expiry date, days until expiry, status.

In `src/toolsets/documents.ts` (export `documentsTools`): `sc_search_documents`, `sc_list_folder_items` (read).

In `src/toolsets/sensors.ts` (export `sensorsTools`): `sc_list_sensors`, `sc_get_sensor_readings` (latest readings for one sensor) (read).

In `src/toolsets/webhooks.ts` (export `webhooksTools`):
- `sc_list_webhooks` (read). Never return the webhook signing key in any output.
- `sc_create_webhook` (write): url must be https; trigger events from the documented enum only.
- `sc_delete_webhook` (destructive).
- Do not implement tools that read or regenerate the signing key.
