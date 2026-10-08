# FAQ

### Is this an official SafetyCulture or Mitti product?
No. It is an independent open-source project (MIT licence) that uses Mitti's public API with your own API token. It is not affiliated with, endorsed by or supported by SafetyCulture Pty Ltd or Mitti. "SafetyCulture" and "Mitti" are their trademarks and are used here only to describe what the software connects to.

### What is MCP?
The Model Context Protocol is an open standard that lets AI assistants (Claude, ChatGPT, Codex, Cursor, VS Code Copilot and others) call tools on your behalf. This server is one of those tools: it gives the assistant safe, structured access to your Mitti account.

### Can it change or delete my data?
Not unless you turn that on. By default only read tools exist in the session, so the assistant cannot call a write tool even if asked to. `SC_MODE=write` allows creating and updating records. `SC_MODE=full` adds delete, archive and bulk tools, and each of those first returns a dry-run plan; nothing changes until the assistant calls again with a one-time confirmation token, which it should only do after you agree. Every write is recorded in a local audit log.

### Where does my data go?
From Mitti's API to the server running on your machine (or your own server), and from there to the AI assistant you use, only the results of the tools it calls. There is no telemetry and no third-party service in between. Your AI provider sees what the assistant sees, so check your provider's data retention settings, especially for work accounts.

### Does the AI get my whole inspection history?
No. Tools return compact, ranked answers (counts, rates, top items, IDs and links), capped at about 25,000 characters per call. Full data sets are exported to files on your disk instead of being pushed into the conversation.

### What about personal information?
By default, email addresses and phone numbers in results are replaced with stable pseudonyms (for example `email_3f9a1c02de`), so the assistant can still group by person without seeing contact details. `SC_PII=strict` also replaces names. `SC_PII=none` shows everything. Exports and reports follow the same setting.

### Can a malicious note in an inspection hijack the assistant?
The server treats everything users typed (notes, descriptions, comments, answers) as untrusted. Those values are wrapped in a labelled data envelope and the server instructs the assistant never to follow instructions inside them. Combined with read-only by default and dry-run confirmation for destructive changes, a planted instruction cannot cause damage on its own. No defence against prompt injection is perfect, which is why the write controls exist.

### How do I make a safe API token?
Create a dedicated integration user with read-only permissions and only the sites it needs, then create the token as that user. Step by step: [guides/api-token.md](guides/api-token.md).

### Which AI apps does it work with?
Any MCP client. Install steps for Claude Desktop, Claude Code, Codex, Cursor, VS Code, Windsurf, Gemini CLI, Zed and ChatGPT (via the HTTP transport) are in [guides/clients.md](guides/clients.md). Each guide says whether that setup was tested.

### Can I try it without a Mitti account?
Yes. `npx -y safetyculture-mcp --demo` runs against a built-in fictional organisation ("Northwind Facilities") with a year of synthetic inspections, actions, issues, schedules and credentials. No token, no network calls to Mitti.

### How fresh are the numbers?
Single-record tools (get an inspection, list actions) call Mitti live. Analyses use a local cache that refreshes any feed older than 60 minutes before computing, and every result states when each feed was last synced. You can force a refresh with `sc_sync`.

### How much API quota does it use?
The client stays under 8 requests per second by default (`SC_REQUESTS_PER_SECOND`), backs off on rate limits, and syncs incrementally after the first download. A first sync of a mid-size organisation takes from seconds to a few minutes depending on the feeds; later syncs fetch only changes.

### Are the statistics trustworthy?
Each analysis states its formula, data window and coverage, and refuses to call a change "up" or "down" on small samples. Comparisons use standard tests (two-proportion z-test, Mann-Whitney U) and say plainly when a difference is probably noise or the data is too thin. See [ANALYTICS.md](ANALYTICS.md). The numbers are reproducible from the cached rows, and the test suite checks them against hand-counted examples.

### Can I get the data into Power BI or Qlik?
Yes. `sc_export_bi_bundle` writes a star schema (CSV) with a Power Query script, a Qlik load script and a manifest. See [guides/bi-export.md](guides/bi-export.md).

### Can I use it for several organisations (consultants, partners)?
Yes: run one server entry per organisation, each with its own token. Each organisation gets its own cache file (named by a fingerprint of the organisation ID), so data never mixes.

### Can my team share one server?
Run the HTTP transport (`safetyculture-mcp http`, or the Docker image) behind your own network controls with `SC_HTTP_BEARER_TOKEN` set. Run one deployment per organisation. Everyone who can reach it gets the token's permissions, so use a least-privilege token and consider `SC_PII=strict`.

### Does it handle time zones and custom periods?
All API timestamps are UTC and analyses use UTC calendar days. Periods can be relative ("last quarter", "last 30 days"), calendar ("2026-Q3", "2026-07") or explicit ranges ("2026-07-01..2026-09-30"), so financial-year windows are a range away.

### What happens when Mitti changes its API?
The server uses Mitti's documented public endpoints and checks responses defensively. Mitti renamed SafetyCulture in August 2026 without breaking the API (`api.safetyculture.io` and `api.mitti.com` both work). Breaking changes will be fixed in releases; the changelog lists them.

### Why not just use Mitti's built-in analytics?
Use both. Mitti's analytics are good for dashboards inside the product. This server adds things that need data from several places at once: failed items searched across every template, backlog ageing joined to sites and assignees, credential expiry across staff and contractors, significance-tested comparisons, audit packs, and exports into your own BI tools, all from the assistant you already use.

### How do I report a security issue?
Privately, through GitHub's vulnerability reporting on this repository. See [SECURITY.md](../SECURITY.md).

### What does it cost?
Nothing. MIT licence. You need a Mitti account in which you can create an API token, and an MCP-capable AI client.
