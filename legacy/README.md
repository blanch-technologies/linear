# Linear Workspace rebuild

A server-backed, multi-user Linear-style workspace for issues, projects, initiatives, Triage intake, recurring cycles, views, files, and Enterprise administration. It runs as a private Site with ChatGPT sign-in, D1 records, and R2 attachments.

## Run locally

Use Node 22.13 or later. Install dependencies, generate the worker, apply the committed D1 migrations to the local preview database, then start the server:

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_broad_ultimatum.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_hard_virginia_dare.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_bored_gladiator.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_adorable_sally_floyd.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_right_dark_phoenix.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_tranquil_mongu.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_chief_zemo.sql
npm run start
```

The hosted Site supplies authenticated identity headers. A plain local browser does not. Use the Sites development preview or a local test harness with synthetic identity headers; never accept browser-supplied identity headers in a public deployment.

## Workflows

- Create, edit, filter, group, search, soft-delete, and restore issues; use list or board view, comments, labels, subscriptions, assignment, and 10 MB attachments.
- Create multi-team projects linked to issues by stable ID, cross-team initiatives, scheduled team cycles, and views. Project renames preserve issue links.
- Submit an Ask as an issue directly in the team's opt-in Triage queue; accept, decline, snooze, or mark it duplicate.
- Organize teams and five levels of subteams, select public/restricted/private visibility, manage team membership, and transfer team ownership.
- Invite members with owner/admin/member/guest roles and revoke pending invitations. Invitations activate when a signed-in user with the invited email visits the Site. Owners can set invitation and team creation policies, a default home, welcome message, and IPv4/IPv6 CIDR allowlist. Approved-domain self-join requires separate domain verification.
- Enforce membership, private-team content access, guest restrictions, and record versions on the server. Administrative and work events appear in the owner audit log.
- Post announcements to members' inboxes, submit app suggestions, create saved Dashboards with Insights, view live workspace counts, and prepare private issue/member/view CSV export jobs or an owner JSON backup job. Completed files are available for seven days.
- Persist all shared data in D1 and files in R2. Sample data is imported only when the owner chooses "Load sample workspace".
- Connect Slack, GitHub, and Notion through provider OAuth after configuring developer apps. Signed Slack and GitHub webhooks enter through a public gateway while the Site remains private. See [integration setup](docs/integrations-setup.md) for supported workflows and remaining limits.

The Site's visitor access policy is separate from workspace membership. Add invited users to the Site's access list as well as the in-app member list. The deployed Site currently has a custom owner-only access list until specific recipients are approved.

## Configuration and limits

Set `BOOTSTRAP_OWNER_EMAIL` as a hosted runtime variable before widening Site access so the first workspace owner is the intended person. Do not put identity-provider secrets in source. SAML SSO, SCIM provisioning, contractual support, billing terms, and full Linear feature parity need separate provider and service configuration. See [Enterprise scope](docs/enterprise-scope.md) and [integration setup](docs/integrations-setup.md) for the remaining work.
