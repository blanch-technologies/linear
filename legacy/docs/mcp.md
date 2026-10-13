# Workspace MCP server

This Site exposes `POST /mcp` for its ChatGPT/Codex plugin and `POST /mcp/external` behind a separate customer gateway. Both serve the records stored in **this workspace**, using membership, team permissions, suspension state, version checks, audit events, and integration side effects from the browser app. They do not connect to a customer's separate `linear.app` workspace.

## Current deployment status

The separate gateway is deployed at the URL below but is **private**. Automatic approval review rejected changing it to public access because that would broaden the security boundary. The Claude Code command is a setup example for **after** public gateway access is explicitly approved, customer Site access is configured, and the endpoint is verified end to end; it is not currently an operational customer connection.

## Claude Code setup after public access is approved

Once a customer has access to the Site, open `/mcp/setup` and create a personal access token. The token is shown once, is stored only as a SHA-256 hash in the workspace database, expires after 30, 90, or 365 days, and can be revoked. Add the remote server with that token:

```sh
claude mcp add --transport http blanch-linear https://blanch-linear-mcp.sleekbat64.chatgpt.site/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

Then open Claude Code and run `/mcp` to verify the connection. The token owner must remain an active workspace member. The current workspace Site access policy permits only `charlesmeng13@gmail.com`; customer accounts must be granted Site access and app membership before they can create tokens. Do not distribute the Site's service bypass token to customers. The gateway holds that token as a server-side secret and forwards each personal token for validation by the private Site.

The private endpoint also supports Sites discovery (`server/discover`, version `2026-07-28`) for the Site's ChatGPT/Codex plugin. Both paths support MCP initialization, ping, tool listing, and tool calls with protocol version `2025-06-18`. Streaming server notifications and resumable sessions are not used. Read-only tokens expose only read tools.

## Tools

Read tools: `list_teams`, `list_issue_statuses`, `list_members`, `list_issues`, `get_issue`, `list_issue_activity`, `list_comments`, `list_projects`, `get_project`, `list_cycles`, `list_initiatives`, `get_initiative`, `list_documents`, `get_document`, `list_customers`, `get_customer`, `list_customer_requests`, `get_customer_request`, `list_release_pipelines`, `list_releases`, `get_release`, `list_issue_templates`.

Write tools: `create_issue`, `update_issue`, `create_comment` (optional `parentId` for a reply), `edit_comment`, `delete_comment`, `react_to_comment`, `resolve_comment_thread`, `subscribe_issue`, `unsubscribe_issue`, `create_project`, `update_project`, `create_initiative`, `update_initiative`, `create_document`, `update_document`, `create_customer`, `update_customer`, `create_customer_request`, `create_release_pipeline`, `create_release`, `update_release`, `create_issue_template`.

List tools return at most 100 records per page with a `nextCursor`. Issue lists omit comments; use `get_issue` or `list_comments` for discussion. Updates accept `expectedVersion` to reject stale writes. Milestones and project updates are embedded in project records; their dedicated MCP actions, along with other Linear MCP operations, still need implementation.

## Deployment and verification

Set `"capabilities": ["mcp"]` in the private workspace Site and publish it. Sites provisions the private app/plugin and authenticates its incoming MCP calls. Deploy the separate gateway Site from `mcp-gateway/` with `MAIN_SITE_BYPASS_TOKEN` configured as a secret. The gateway should be publicly reachable because it requires a per-user Bearer token on every MCP request. Keep the workspace Site audience aligned with the desired customer access policy.

Check discovery and read access with an authenticated client. An anonymous `initialize` must fail. A suspended or nonmember account must fail. A guest must not receive initiatives or inaccessible team issues. A write through MCP should appear in the browser and audit log.
