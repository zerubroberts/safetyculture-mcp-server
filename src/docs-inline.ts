export const SAFETY_MODEL = `# Safety model

1. **Read-only by default.** With no settings, only tools that read data are available.
2. **Writes are opt-in.** Set SC_MODE=write to allow creating and updating records (actions, issues, inspections, assets...).
3. **Destructive changes need two steps.** SC_MODE=full adds delete, archive and bulk tools. Each call first returns a dry-run plan and a one-time confirm token bound to the exact arguments; nothing changes until the same call is repeated with that token. Tokens expire after 10 minutes.
4. **Every write is logged locally** to an append-only JSONL audit log (default ~/.safetyculture-mcp/audit.jsonl), including the reason given.
5. **Secrets never leave the server.** The API token is read from the environment, never written to logs, and stripped from every error and result. Support-system hashes returned by the API are removed.
6. **Personal data is minimised.** By default emails and phone numbers in results are replaced with stable pseudonyms (SC_PII=contact). SC_PII=strict also pseudonymises names; SC_PII=none shows everything.
7. **Record text is treated as untrusted.** Notes and descriptions written by users are wrapped and labelled so the AI treats them as data, not instructions.
8. **No telemetry.** The server talks only to the Mitti API host you configure.
`;
