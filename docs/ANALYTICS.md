# Analytics: what each analysis computes

Every analysis runs on a local copy of your Mitti Data Feeds (see [How the cache works](#how-the-cache-works)) and returns the same envelope:

| Field | Meaning |
|---|---|
| `period` | The exact UTC window used, e.g. `last 30 days (2026-09-09 to 2026-10-08)` |
| `as_of` | When the numbers were computed |
| `coverage` | For every feed used: rows cached, when it was last synced, whether the sync was complete |
| `metrics` | Headline numbers |
| `table` | Ranked rows behind the numbers |
| `method` | The formula, in one or two sentences (the same text as below) |
| `caveats` | Anything that limits the result: partial feeds, small samples, independence warnings |

Numbers are computed from cached rows only. Nothing is estimated or extrapolated. When a feed is empty, never synced or still downloading, the result says so instead of reporting zero.

## Shared definitions
- **Completed inspection**: an inspection with a completion date, not archived.
- **Answered item**: an active inspection item of a pass/fail type (multiple-choice `question` and `list` items) with a non-empty response. Measured on a real organisation, `is_failed_response` is only ever true on these two types; counting text, section, signature or smart-field items would inflate the denominator and understate failure rates.
- **Failed item**: an answered item flagged `is_failed_response`.
- **Open action**: status To do or In progress. **Overdue**: open with a due date before now.
- All dates are UTC. Periods accept `last 30 days`, `last quarter`, `2026-Q3`, `2026-07`, `2026-07-01..2026-09-30`, `ytd`, `next 30 days` and similar.

## Core analyses (in the default tool set)

### Safety pulse: `sc_safety_pulse`
The Monday briefing. Each metric is computed for the period and the equal-length period before it. Failed-item rate = failed answered items / answered items in completed inspections; average score = mean score % of scored inspections; open overdue actions = open actions due before now. A direction ("up", "down") is only stated when both periods have at least 20 observations. Three **attention** items are chosen by a fixed severity order: overdue high-priority action, then a missed scheduled inspection, then a failed-rate jump of 10 percentage points or more on a template (with at least 20 answered items in both periods), then a new high-priority issue.

### Failed items Pareto: `sc_analyze_failed_items`
Failed items are answered items flagged `is_failed_response` in completed, non-archived inspections whose completion date is in the period. Share = group failed / all matching failed; failure rate = group failed / answered items of the same questions in that group. Search across every template with a text query (`fire extinguisher|exit`), group by item, template, site or inspector.

### Action backlog: `sc_analyze_action_backlog`
Open = status To do or In progress. Age = whole days since created; overdue = due date before now, in whole days past due. Resolution = created to completed for actions completed in the period (median and 90th percentile, type-7 interpolation). Ageing buckets 0-7, 8-30, 31-90, 90+ days; open actions with no due date are counted separately; opened vs closed per week.

### Schedule compliance: `sc_analyze_schedule_compliance`
Occurrences due in the period, one per schedule occurrence. Compliance = completed on time / (on time + late + missed); late and missed are shown separately; won't-do and not-yet-resolved occurrences are excluded from the denominator.

### Credential radar: `sc_analyze_credential_radar`
Days left = expiry date minus today's date (UTC). Expired = before today; buckets: 0-7, 8-30, 31-90 days. Only the latest-expiring credential per person and type counts (a renewed licence hides the one it replaced; the number hidden is stated); anything expiring on or after the horizon end is excluded.

## Further analyses (enable the `analytics` toolset)

### Site league table: `sc_analyze_site_league`
For each metric, sites get a z-score (population standard deviation across ranked sites), signed so higher is better (failed-item rate, overdue actions and resolution days count against). Composite = equal-weight mean of the available z-scores; rank change = previous-period rank minus current rank. Sites below the minimum inspection count are listed separately with the reason.

### Real difference or noise: `sc_analyze_compare`
Compares two periods or two groups of sites. Failed-item rate: pooled two-proportion z-test with Cohen's h (needs at least 5 expected failures and passes per group). Inspection score and action resolution days: Mann-Whitney U with rank-biserial effect size (needs at least 8 per group). Verdict "real difference" when p < 0.05, "probably noise" otherwise, "not enough data" below the minimums. Caveats always state that repeated inspections of one site are not independent (p-values are optimistic) and that running three tests at once means about one in twenty equal comparisons will still look real.

### Trends: `sc_analyze_inspection_trend`
Inspections completed, average score, failed-item rate, issues created, actions created or completed, by ISO week (Monday start) or calendar month, clipped to the period. Slope is an ordinary least-squares fit of value on bucket index; a direction is only stated with at least 6 usable buckets and is "flat" when the fitted change is under 5% of the mean. Partial weeks or months at the edges are left out of the slope for count metrics.

### Template quality: `sc_analyze_template_quality`
Per item (normalised label within the template), over completed inspections in the period. Fail rate = failed / answered; N/A rate = responses "N/A", "NA" or "not applicable" / answered; skip rate = blank / times shown outside conditional logic. "Cut candidate": answered at least 200 times and never failed (question and list items only), or N/A every time (at least 10 answers). "Fix": skip or N/A rate of 50% or more (at least 10 showings). Everything else "keep". Duration is the feed's duration field, read as seconds.

### Inspector activity: `sc_analyze_inspector_activity`
Inspector = inspection owner. Failed-item rate = failed / answered items on their completed inspections. Expected rate = the organisation's failed-item rate per template, weighted by that inspector's answered items on each template, so people are compared on the same template mix. Very fast = duration under 25% of the template's median (templates with at least 10 timed inspections). This is not a performance score: volume depends on role, roster and assigned sites.

### Anomalies: `sc_analyze_inspection_anomalies`
- `too_fast`: duration under 25% of the template median (templates with at least 10 timed inspections in the period).
- `perfect_streak`: 10 or more consecutive 100% scores by one inspector on a template whose organisation-wide failed-item rate is at least 5%.
- `duplicate_burst`: 3 or more inspections of one template by one inspector completed within 5 minutes of the first.
- `score_outlier`: robust z = 0.6745 x (score - median) / MAD within the template, beyond 3.5.
Results describe evidence and never accuse anyone.

### Where actions stall: `sc_analyze_action_stalls`
Per action, the timeline is replayed from creation: time accrues to the current status until each status change, ending at completion (or now when open). Longest gap = the longest stretch between consecutive timeline events. Reports due-date changes and reassignments, and in aggregate, where open-status time goes.

### Issue hotspots: `sc_analyze_issue_hotspots`
Issues by created date in the period, grouped by category and site. Rate = issues / completed inspections at that site in the same period x 100. Rising = a category with at least 10 issues this period and more than in the previous equal-length period. Fewer issues can mean less reporting, not fewer hazards.

## Reports
`sc_report_safety_pulse`, `sc_report_audit_pack` and `sc_report_site_scorecard` assemble the analyses above into a self-contained HTML file (inline CSS and SVG, no scripts, no external requests, printable on A4) plus a Markdown twin, saved under `~/.safetyculture-mcp/exports/reports/`. The header shows a short fingerprint of the organisation, never its name or ID.

## How the cache works
- One SQLite file per organisation at `~/.safetyculture-mcp/cache/<fingerprint>.sqlite` (file mode 0600), built into Node.js (no native installs).
- Analyses sync only the feeds they need, when the cached copy is older than 60 minutes. `sc_sync` and `sc_sync_status` give you control.
- Incremental feeds use the last modified time with a 10-minute overlap; rows are upserted by ID so overlaps never double count. Feeds without an incremental filter are re-pulled in full and replaced in one transaction.
- Some Mitti feeds are slow on first download (for example action timelines arrive at roughly 150 rows per page, several seconds per page). A tool waits up to 40 seconds (`SC_SYNC_BUDGET_MS`), then answers with what has arrived, clearly marked partial, while the download continues in the background.
- Feeds your organisation has not licensed are recorded as unavailable, and analyses that need them say so.
