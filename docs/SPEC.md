# safetyculture-mcp: product and build spec (v0.1, 2026-10-08)

Merged from the Astra architecture critique and the Fable strategy plan; decisions by the orchestrator.

## Thesis
API wrappers are table stakes. The product is **answers, not payloads**: a local cache plus analytics that let an EHS manager ask questions across inspections, actions, issues, schedules and credentials, safely. **Trust is the feature**: read-only default, two-step destructive writes, audit log, PII minimisation, no telemetry.

## Architecture decisions
| Decision | Choice | Dissent noted |
|---|---|---|
| Runtime | TypeScript, Node >= 22.13, official MCP SDK, zod | |
| Transports | stdio (npx) + Streamable HTTP (stateless, one server per request) | |
| API host | `https://api.mitti.com` default (verified live), `api.safetyculture.io` still works | |
| Cache | `node:sqlite` (built in, zero native deps) | Astra preferred DuckDB; rejected for Windows/ARM npx install risk |
| Tool count | ~25 default ("core: true"), ~125 total in 20 toolsets, `sc_enable_toolsets` for more | Fable: dynamic enable not load-bearing; documented path is `SC_TOOLSETS` |
| Updates | one patch-style `sc_update_<thing>` per object, not one tool per field | |
| Writes | `SC_MODE=read-only` (default) / `write` / `full`; destructive = dry-run + single-use confirm token bound to exact args | Astra: approval outside model args for the most dangerous ops (future: MCP elicitation) |
| Audit | local JSONL, intent + outcome, `reason` field on every write | Astra: tamper-evident checkpoints later |
| PII | `none` / `contact` (default: emails+phones pseudonymised, HMAC keyed per org) / `strict` (names too) | Fable: force strict on shared HTTP deployments |
| Untrusted text | every result containing user-typed text is wrapped in `<untrusted-data>` with a notice | |
| Results | `summary` sentence + compact JSON; analytics also carry `as_of`, `coverage`, `method`, `caveats` | |
| Truncation | shrink largest arrays + say so; analytics never compute from truncated data; exports for full sets | |
| Demo mode | `SC_DEMO=true` serves a deterministic synthetic organisation via a fake fetch: zero-token trial, all screenshots | |

## Toolsets, tools and owners
`*` = core (default set). R read, W write, D destructive. Owner = the ticket that builds it.

| Toolset (file) | Tools | Owner |
|---|---|---|
| core (`core.ts`) | sc_whoami*, sc_list_toolsets*, sc_enable_toolsets*, sc_web_links, sc_api_get | orchestrator (done) |
| actions (`actions.ts`) | sc_list_actions*, sc_get_action*, sc_list_action_options, sc_create_action* W, sc_update_action* W, sc_create_action_link W, sc_bulk_update_actions D, sc_delete_actions D | orchestrator (done, reference) |
| inspections (`inspections.ts`) | sc_search_inspections*, sc_get_inspection*, sc_get_inspection_answers*, sc_get_inspection_report_link*, sc_export_inspection_document, sc_list_inspection_media, sc_get_media_url, sc_start_inspection W, sc_update_inspection W, sc_complete_inspection W, sc_clone_inspection W, sc_share_inspection W, sc_restore_inspection W, sc_archive_inspection D, sc_delete_inspection D | W1 |
| templates (`templates.ts`) | sc_list_templates*, sc_get_template*, sc_list_response_sets, sc_get_response_set, sc_restore_template W, sc_archive_template D | W1 |
| issues (`issues.ts`) | sc_list_issues*, sc_get_issue*, sc_count_issues, sc_list_issue_categories, sc_get_issue_timeline, sc_get_issue_report, sc_create_issue* W, sc_update_issue* W, sc_comment_on_issue W, sc_delete_issues D | W2 |
| investigations (`investigations.ts`) | sc_list_investigations, sc_get_investigation, sc_create_investigation W, sc_update_investigation W, sc_list_osha_cases, sc_get_osha_case, sc_list_osha_establishments | W2 |
| assets (`assets.ts`) | sc_list_assets, sc_get_asset, sc_find_asset, sc_list_asset_types, sc_list_asset_fields, sc_list_maintenance_programs, sc_get_asset_maintenance, sc_maintenance_status_counts, sc_create_asset W, sc_update_asset W, sc_archive_asset D | W3 |
| sites (`sites.ts`) | sc_list_sites*, sc_get_site, sc_site_tree, sc_list_site_members, sc_create_site W, sc_add_site_members W | W3 |
| people (`people.ts`) | sc_search_users*, sc_get_user, sc_list_groups, sc_list_group_members, sc_list_permission_sets, sc_add_user_to_group W, sc_remove_user_from_group D | W3 |
| schedules (`schedules.ts`) | sc_list_schedules*, sc_get_schedule, sc_list_schedule_occurrences, sc_pause_schedule W, sc_resume_schedule W, sc_end_schedule D | W4 |
| training (`training.ts`) | sc_list_courses, sc_get_course, sc_list_training_paths, sc_get_course_progress, sc_training_leaderboard, sc_assign_course W | W4 |
| headsup (`headsup.ts`) | sc_list_heads_ups, sc_get_heads_up | W4 |
| contractors (`contractors.ts`) | sc_list_companies, sc_get_company, sc_list_company_documents, sc_list_credential_types, sc_list_credentials | W4 |
| documents (`documents.ts`) | sc_search_documents, sc_list_folder_items | W4 |
| sensors (`sensors.ts`) | sc_list_sensors, sc_get_sensor_readings | W4 |
| webhooks (`webhooks.ts`) | sc_list_webhooks, sc_create_webhook W, sc_delete_webhook D | W4 |
| feeds (`feeds.ts`) + `src/cache/**` | sc_list_feeds, sc_read_feed, sc_sync*, sc_sync_status*, sc_export_dataset*, sc_query_cache | W5 |
| integrations (`integrations.ts`) + `src/exports/**` | sc_export_bi_bundle (star schema CSV + Power Query M + Qlik load script + manifest), sc_post_to_chat W (Slack/Teams incoming webhooks allowlisted by env) | W5 |
| analytics (`analytics.ts`) + `src/analytics/**` | sc_safety_pulse*, sc_analyze_failed_items*, sc_analyze_action_backlog*, sc_analyze_schedule_compliance*, sc_analyze_credential_radar*, sc_analyze_site_league, sc_analyze_compare_periods, sc_analyze_inspection_trend, sc_analyze_template_quality, sc_analyze_inspector_activity, sc_analyze_inspection_anomalies, sc_analyze_action_stalls, sc_analyze_issue_hotspots | W6 |
| reports (`reports.ts`) | sc_report_safety_pulse, sc_report_audit_pack, sc_report_site_scorecard (self-contained HTML/Markdown files) | W6 |
| demo (`src/demo/**`) | synthetic organisation generator + fake fetch for `SC_DEMO=true` | W7 |

## Hero workflows (acceptance journeys)
1. Monday safety pulse across all sites (prompt `weekly_safety_review`).
2. Audit / regulator evidence pack (prompt `audit_readiness_pack`).
3. Find failed items about X across templates, raise one action per site after review.
4. Credentials expiring before a shutdown date, grouped by company.
5. Is site Y really worse than site Z? (significance-tested comparison).
6. Template hygiene: questions that never fail / always N/A.
7. Investigation paper trail across inspection, actions, issues.
8. Missed scheduled inspections and suspiciously fast inspections.

Launch definition: a new user with a read-only token runs journey 1 within 5 minutes of the README, and numbers reconcile to the Mitti UI on spot-check.
