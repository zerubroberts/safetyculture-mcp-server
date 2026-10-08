# Changelog

## 0.1.0 (unreleased)
Complete rewrite of the 2025 Python prototype (6 tools) as a TypeScript MCP server.

### Added
- 125 tools in 20 toolsets: inspections, templates, actions, issues, investigations and OSHA, assets and maintenance, sites, people, schedules, training, Heads Up, contractors and credentials, documents, sensors, webhooks, data feeds, analytics, reports, integrations. Generated reference: [docs/TOOLS.md](docs/TOOLS.md).
- Small default tool set (26 read tools) with `SC_TOOLSETS` and the `sc_enable_toolsets` tool for more.
- Safety model: read-only by default; `SC_MODE=write` and `SC_MODE=full`; dry-run plus single-use confirm tokens for destructive tools; local audit log; secret redaction; keyed pseudonyms for contact details (`SC_PII`); untrusted-data envelope against prompt injection; no telemetry.
- Local analytics cache on Node's built-in SQLite with incremental, time-budgeted sync of 23 Data Feeds.
- 13 analyses (safety pulse, failed-item Pareto, action backlog, schedule compliance, credential radar, site league, significance-tested comparisons, trends, template quality, inspector activity, anomalies, action stalls, issue hotspots) and 3 generated HTML/Markdown reports.
- Exports: CSV/JSONL datasets, Power BI / Qlik star-schema bundle, read-only SQL over the cache, Slack and Teams posting to operator-allowlisted webhooks.
- Transports: stdio and stateless Streamable HTTP with bearer and Origin checks; Dockerfile.
- CLI: `doctor`, `tools`, `config <client>`, `--demo`.
- MCP prompts for weekly safety review, audit readiness, failed-item actions, change investigation, credential check, template hygiene.

### Security
- The 2025 prototype's repository history contained a committed `.env` with an API key. That key was verified revoked (HTTP 401) on 2026-10-08, and the repository history was replaced.
