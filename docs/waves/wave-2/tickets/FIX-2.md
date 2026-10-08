# FIX-2: schedules, training, sites review findings
Findings: 7, 10, 12, 13, 17, 18, 20.
FILES ALLOWED: src/toolsets/schedules.ts, src/toolsets/training.ts, src/toolsets/sites.ts, test/toolsets/schedules.test.ts, test/toolsets/training.test.ts, test/toolsets/sites.test.ts.
Note for 12: schedule IDs from the current scheduling feed look like `scheduleitem_<32 hex>` and must be sent to /scheduling/v1/schedules/{id} as a dashed UUID (already done via ids.uuid, verified live). Legacy schedule items come from /schedules/v1/schedule_items; route those to the legacy API or clearly refuse with a helpful message.
