#!/usr/bin/env node
// Leak guard. Fails if tracked or staged files contain anything that looks like a real secret or
// real customer data. Runs in CI and as a pre-commit hook.
//
// Checks:
//  1. API tokens (scapi_...), bearer headers, 64-hex keys, private keys
//  2. Email addresses outside example/test domains
//  3. A private denylist of organisation / client / person names, one per line, read from
//     $SC_LEAK_DENYLIST or ~/.safetyculture-mcp/denylist.txt. The denylist itself is never committed.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/(^|\/)(node_modules|dist|\.cache)\//.test(f) && !/\.(png|jpe?g|gif|webp|ico|woff2?|lock)$/i.test(f) && f !== "package-lock.json");

const PATTERNS = [
  ["API token", /scapi_[A-Za-z0-9]{20,}/],
  ["Bearer token", /Bearer\s+(?!\$\{|<|scapi_your|your)[A-Za-z0-9_\-.]{24,}/],
  ["64-hex key", /\b[a-f0-9]{64}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const OK_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net|test)|test|invalid|localhost|users\.noreply\.github\.com|anthropic\.com)$/i;
const ALLOW_FILE = /^(scripts\/scan-secrets\.mjs|test\/core\/security\.test\.ts)$/;

const denyPath = process.env.SC_LEAK_DENYLIST ?? join(homedir(), ".safetyculture-mcp", "denylist.txt");
const deny = existsSync(denyPath)
  ? readFileSync(denyPath, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"))
  : [];

const findings = [];
for (const f of files) {
  if (!existsSync(f)) continue;
  const text = readFileSync(f, "utf8");
  if (!ALLOW_FILE.test(f)) {
    for (const [name, re] of PATTERNS) if (re.test(text)) findings.push(`${f}: ${name}`);
    for (const m of text.matchAll(EMAIL)) if (!OK_EMAIL_DOMAINS.test(m[1])) findings.push(`${f}: email address (${m[1]})`);
  }
  const lower = text.toLowerCase();
  for (const d of deny) if (lower.includes(d.toLowerCase())) findings.push(`${f}: denylisted name #${deny.indexOf(d) + 1}`);
}

if (findings.length) {
  console.error(`Leak guard FAILED (${findings.length}):\n  ${[...new Set(findings)].join("\n  ")}`);
  process.exit(1);
}
console.log(`Leak guard passed: ${files.length} files, ${deny.length} denylist entries${deny.length ? "" : " (no private denylist found)"}.`);
