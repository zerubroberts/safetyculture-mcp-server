# Create a Mitti API token (least privilege)

An API token acts with the permissions of the Mitti user who created it. Give the server only what it needs.

## Recommended setup
1. **Create a dedicated user** in Mitti for the integration, for example "AI assistant (read-only)". Using a named integration user keeps audit trails clear and lets you revoke access without affecting a person.
2. **Give it the narrowest permission set** that covers what you want to ask about:
   - Read-only analysis: permission to view inspections, actions, issues, assets and schedules, and the sites it should see. No "manage" or "delete" permissions.
   - If you will enable writes (`SC_MODE=write`): add permission to create and edit actions and issues only.
3. **Limit site access** if the assistant should only see some regions.
4. **Sign in as that user and create the token**: in Mitti go to your profile, then **Integrations** (or **Settings > Integrations > API tokens**), and generate a token. Mitti's own guide: https://help.mitti.com/en-US/000007/
5. Copy the token (it starts with `scapi_`). Mitti shows it once.

## Store it safely
- Put it in your MCP client's environment configuration (see the install guides), an OS keychain-backed secret, or your secrets manager. Never commit it to a repository or paste it into a chat.
- VS Code can prompt for it at start-up with an `inputs` entry so it is never written to a file (see [vscode.md](clients.md#vs-code)).

## Check it
```bash
SC_API_TOKEN=scapi_... npx -y safetyculture-mcp doctor
```
`doctor` confirms the token works, shows a fingerprint of the organisation (not its name), the server mode and how many tools will be exposed. It never prints the token.

## Revoke it
Revoke or regenerate the token in the same Integrations screen, or deactivate the integration user. The server stops working immediately; nothing is cached that bypasses Mitti's permissions (the local analytics cache only holds data the token could already read, and you can delete `~/.safetyculture-mcp/cache/` at any time).
