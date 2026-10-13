# Slack, GitHub, and Notion setup

The app has direct OAuth connections, encrypted provider credentials, signed webhook processing, and settings for Slack channels and GitHub repositories. The hosted Site stays owner-private. Provider webhooks must reach the public gateway in `integrations/gateway`, which verifies each signature and forwards the original request to the private Site using a Sites service access token. Do not make the Site public to receive webhooks.

No provider developer apps or secrets have been supplied yet. Until they are configured, the Integrations page correctly shows **Developer app setup required** and does not offer a Connect button.

## 1. Secrets and gateway

Generate a 32-byte base64 encryption key with `openssl rand -base64 32`. Add it as `INTEGRATION_ENCRYPTION_KEY` in the Site's hosted runtime secrets. Keep the value stable; rotating it without re-encrypting stored connections makes the connections unreadable.

Deploy `integrations/gateway/worker.ts` as a public Cloudflare Worker with `integrations/gateway/wrangler.toml`. Set these Worker secrets using Cloudflare's secret manager:

- `SITE_SERVICE_TOKEN`: the private Site's service access token, obtained through Sites service access. Never add this token to client code or the repository.
- `SLACK_SIGNING_SECRET`: exactly the same signing secret used in the Site runtime.
- `GITHUB_WEBHOOK_SECRET`: exactly the same random webhook secret used in the Site runtime.

Set `SITE_URL` to the private Site's origin (currently `https://linear-workspace-rebuild.sleekbat64.chatgpt.site`). Configure the gateway's public `workers.dev` URL or custom domain in Slack and GitHub. The gateway accepts only `/webhook/slack` and `/webhook/github`, checks request size and provider signatures, and forwards verified requests to `/api/integrations/webhook` on the private Site. The Site verifies the signatures again and deduplicates deliveries.

Do not paste secrets into `.env.example`, Git, or support tickets. The Site's visitor access list remains unchanged.

## 2. Slack app

Create a new Slack app at [api.slack.com/apps](https://api.slack.com/apps) and choose the workspaces where it may be installed. Set OAuth redirect URL to:

```text
https://linear-workspace-rebuild.sleekbat64.chatgpt.site/api/integrations/callback
```

Add bot token scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `commands`, `groups:history`, `groups:read`, `links:read`, and `links:write`. Add these event subscriptions to `https://<gateway-host>/webhook/slack`: `app_mention`, `message.channels`, `message.groups`, and `link_shared`. Register the Site's domain under App Unfurl Domains. Add the `/blanch` slash command with the same request URL. Enable Interactivity with the same URL and add a message shortcut with callback ID `create_issue`. Install the app into each Slack workspace.

Add `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET` to the Site's runtime secrets. In Integrations, connect Slack as the workspace owner, load channels, invite the bot into selected channels, map channels to teams, and save. Private and restricted teams can map only to private Slack channels, and the bot must be a member. People in the Slack channel may have different access from the app team; verify channel membership before mapping sensitive teams.

Supported today: create an issue from a mapped channel through an app mention, slash command, or message shortcut; route it to the team's Triage queue when enabled; post a linked reply; sync subsequent thread replies into issue comments; post new app issues and app updates into linked Slack threads; unfurl public issue links. Personal Slack notifications, project/initiative/view notifications, rich issue action buttons, and full Linear Asks configuration remain to be built.

## 3. GitHub App

Register a GitHub App in [GitHub Developer settings](https://github.com/settings/apps/new). Set the Homepage URL to the Site and the user authorization callback URL to:

```text
https://linear-workspace-rebuild.sleekbat64.chatgpt.site/api/integrations/callback
```

Set the setup URL to:

```text
https://linear-workspace-rebuild.sleekbat64.chatgpt.site/api/integrations/github/setup
```

Leave **Request user authorization during installation** off: this flow authorizes the user first and then needs GitHub's setup URL after installation. Use a webhook URL of `https://<gateway-host>/webhook/github` and a new random webhook secret. Grant repository permissions: Metadata read, Contents read, Pull requests read, Issues read/write, and Checks read. Subscribe to `installation`, `pull_request`, `push`, `issues`, `issue_comment`, `pull_request_review`, and `check_run` events. Generate a private key and store it as a Site secret.

Add `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` to the Site runtime. The private key may contain literal newlines or escaped `\n`. In Integrations, connect GitHub as the owner, select repositories, map each repository to a team, choose PR status automation, and optionally enable GitHub Issues sync. The callback checks both the authenticated user's installation access and the App's installation identity before saving it. User OAuth tokens used during setup are short-lived and are not kept in the saved connection.

Supported today: PR and commit references based on issue IDs in branch names, titles, bodies, and commit messages; PR status automation; linked review/check metadata; GitHub Issues and comment import; app edits and comments syncing back to imported GitHub issues when Issues sync is enabled. New app issues are not automatically created in GitHub. Code Intelligence, Diffs, agentic coding, deployment automation, and the full Linear GitHub Issues Sync behavior remain to be built.

## 4. Notion

Create a public Notion integration in [Notion My Integrations](https://www.notion.so/profile/integrations) and set this redirect URI:

```text
https://linear-workspace-rebuild.sleekbat64.chatgpt.site/api/integrations/callback
```

Add `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` as Site runtime secrets. Members can then authorize their Notion workspace in Integrations. The Site stores the resulting token encrypted per member. Linear's Notion feature is live link previews of issues, projects, initiatives, and views inside Notion. [Notion restricts that link-preview platform to selected partner services](https://developers.notion.com/guides/link-previews/introduction). The OAuth connection alone cannot activate our URLs as native Notion previews. Apply for Notion partner access and implement their preview contract once approved; until then the UI explicitly shows the connection as authorization only.

## Validation before enabling a workspace

After secrets and provider apps are installed, confirm the Integrations page reports credentials configured. Complete OAuth for one test workspace/account. Send signed test events from Slack and GitHub through the gateway; verify webhook deliveries, issue/comment creation, PR links, status changes, and failed-signature rejection. Confirm private issue links do not unfurl in Slack, and verify team/channel and repository/team mappings against a test workspace before rolling out to production channels and repositories.
