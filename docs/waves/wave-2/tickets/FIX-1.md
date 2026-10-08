# FIX-1: inspections + templates review findings
Findings: 1, 2, 6, 8, 16, 21.
FILES ALLOWED: src/toolsets/inspections.ts, src/toolsets/templates.ts, test/toolsets/inspections.test.ts, test/toolsets/templates.test.ts.
Extra for finding 1/16: validate every requested change before issuing the first API call, so a bad answer never leaves a half-updated inspection.
