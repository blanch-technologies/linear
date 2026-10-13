# Functionality in the rebuild that diverges from Linear

Audited October 12, 2026 against the deployed Site, repository source, and Linear's current public documentation. The target is Linear Enterprise behavior. **P0** means a security or data-loss divergence, **P1** a core workflow or data-model divergence, and **P2** a narrower product mismatch. This audit concerns behavior our app currently exposes; it is not a full inventory of missing Linear features.

## Correction status

The source changes following this audit are summarized below. This is an implementation status, not a claim of full Linear Enterprise parity.

| Finding | Current correction | Remaining difference |
| --- | --- | --- |
| Private-team admin access | Explicit membership required for content, attachments, exports; local role matrix passed | Owners/admins still see team metadata so they can join |
| Immediate deletion | Soft deletion, Recently deleted, restore, retained attachments | Expired records purge on the next workspace request; no independent scheduled worker |
| Separate Requests objects | New Asks create issues directly in opt-in Triage; legacy requests migrate to issues | External requester conversation sync needs an intake integration |
| Free-text app approval | Reframed as App suggestions, without claiming an OAuth grant | Real install approvals need a provider integration |
| Allowed domains block invitations | Invitation restriction removed | Verified-domain self-join needs a company domain, verification, and Site access |
| Team hierarchy | Restricted children require a private parent; parent memberships and management inheritance enforced for new changes; reparenting is admin-only | Older nonconforming hierarchies need a reviewed migration |
| Single-team projects and name links | Project-team relation and stable issue `projectId`; legacy links backfilled | Older ambiguous duplicate-name links may need manual review |
| Fake My issues tabs | Persisted subscriptions and user-specific issue events | Historical activity before this change is not reconstructed |
| Guest exposure | Guest UI and APIs limited to assigned team issues/projects and personal inbox | Site access still needs separate admission |
| Fixed Dashboards | Fixed metrics page renamed Overview; saved Dashboards now support ownership, visibility, team/status filters, and metric/chart/table Insight blocks | Advanced Insights calculations and sharing controls remain |
| Manual cycles | New teams generate recurring cycles with current cycle derived from dates and rollover across inactive periods | Advanced date editing and schedule changes need further work |
| Required team owner | Zero explicit team owners allowed | Workspace admins retain management rights |
| Raw JSON export | Background issue, member, and view CSV jobs with private-team option, owner-only downloads, and audit event; JSON relabeled backup | Attachment files remain separate; large exports retain a 20,000-record limit |
| Exact IPs only | IPv4/IPv6 addresses and CIDR ranges validated and enforced | None known in this finding |
| Announcement feed only | Audience-specific inbox notifications and delivery status | Email and Slack need configured providers |
| Welcome message unused | First-visit message, seen state, and owner preview | None known in this finding |
| Automatic demo import | Owner opt-in sample import; new team counter starts at 1 | Existing live demo records are preserved |
| Global Triage status | Team opt-in, dedicated queue, accept/decline/snooze/duplicate actions, excluded from ordinary issue views | Richer triage rules and integrations remain |

The deployed Site was checked read-only. The findings below are based primarily on code, so they describe what the server permits even when the owner-only Site currently prevents another user from exercising that path in production. No production records or settings were changed during this audit.

## Confirmed findings

### P0 — Private team administrators have access Linear Enterprise does not grant

`canReadTeam` and `canWriteTeam` return true for any workspace owner or admin before checking team membership (`lib/workspace-server.ts:119-135`). Every records and attachment route uses those checks. Thus an admin can read and change a private team's issues, projects, requests, and attachments without joining that team. Linear Enterprise allows an owner to add themself to a private team, but its issues are visible only **after** joining; nonmembers cannot see private issues. The current implementation creates a material confidentiality and integrity difference. [Linear private teams](https://linear.app/docs/private-teams).

**Align:** Separate administrative visibility of team metadata from access to its content. Require explicit membership or an issue-specific share grant for all private content reads and writes, including export behavior. Test owner, admin, member, and guest access to private team issues, projects, attachments, search, notifications, and dashboards before and after joining.

### P0 — Delete means immediate physical deletion

The `delete` action removes a row from `records` immediately (`app/api/records/route.ts:267-285`), and the issue path also deletes attachment objects from R2. The UI's Delete issue and Delete project actions call it (`public/linear.js:259,265`). Linear keeps deleted issues and projects recoverable in Recently deleted for 30 days, with undo for a just-deleted issue. [Linear delete and archive issues](https://linear.app/docs/delete-archive-issues), [projects](https://linear.app/docs/projects).

**Align:** Use a deleted timestamp, a Recently deleted view, restore actions, and a 30-day purge job. Keep attachments until purge. Preserve audit references and linked records across delete/restore.

### P1 — “Requests” is a separate object that Linear Asks does not create

Our app has a top-level Requests page with a form, `request` records, and a New → Accepted/Declined queue (`public/linear.js:161-164`; `app/api/records/route.ts:6-18,141-145,196-235`). Accepting creates a **second**, new issue. Linear Asks creates an issue at submission; that issue enters the team's Triage and is accepted, declined, snoozed, or marked duplicate there. A requester conversation can stay synchronized with the intake channel. [Linear Asks](https://linear.app/docs/linear-asks), [Triage](https://linear.app/docs/triage).

**Align:** Convert request intake to issue creation with source/requester metadata, then use the issue's Triage lifecycle. Migrate existing `request` records without losing descriptions or links; remove the separate queue once migrated. Support the same triage actions and requester visibility.

### P1 — “Applications” approval is a free-text decision, not app authorization

Our member can type any application name and reason; `app.request` stores a JSON record, and `app.decide` changes its status to approved or denied (`public/linear.js:197-199`; `app/api/admin/route.ts:247-270`). Approval does not identify an OAuth client, evaluate scopes, or grant access. Linear presents approval when a member tries to install a particular third-party app; approved and denied apps are tracked in Applications and both sides receive notifications. [Linear third-party app approvals](https://linear.app/docs/third-party-application-approvals).

**Align:** Tie a request to a real installation attempt and immutable application identity/scopes. Approval should resume or permit only that installation. Retain the current free-text request form, if desired, as a clearly labeled suggestion workflow outside Applications.

### P1 — “Allowed email domains” has the opposite effect

Our `allowedDomains` setting blocks invitations to every other domain (`app/api/admin/route.ts:109-119`). Linear's approved email domains allow people **on** those domains to join without an invitation; they do not define a denylist for invitations. This particularly affects invited guests and contractors. [Linear invite members](https://linear.app/docs/invite-members).

**Align:** Rename the current control if a separate invite-domain restriction is truly wanted. To match Linear, use approved domains for self-join, keep manual invitations independent, and require domain ownership verification and compatible Site access before enabling self-join.

### P1 — The team visibility and hierarchy rules describe a different access model

Our teams can independently select `public`, `restricted`, or `private` at any hierarchy position (`app/api/admin/route.ts:66-105`). The backend treats `restricted` like `private` for nonmembers (`lib/workspace-server.ts:119-135`). It does not enforce a non-guest sub-team member also belonging to its parent, does not inherit parent ownership, and allows a team owner who is not a workspace admin to reparent a team. Linear's Restricted sub-team is visible to members of its private parent, non-guest sub-team membership requires parent membership, parent owners inherit ownership, and changing parent requires admin permission. [Linear sub-teams](https://linear.app/docs/sub-teams), [members and roles](https://linear.app/docs/members-roles).

**Align:** Model visibility by parent relationship, enforce membership and owner inheritance on create/move/add/remove, and make reparenting admin-only. Add migration rules for existing `restricted` teams before changing access checks.

### P1 — Projects are single-team records linked to issues by name

A project has one `team_id`; issue validation looks up a project in the issue's team by its display name (`app/api/records/route.ts:42-50,131-171`). Project views and progress also match `project` text plus `teamId` (`public/linear.js:74,78-79,99-100`). Linear projects can involve multiple teams, with a lead team; project and issue identity is stable across renames. [Linear projects](https://linear.app/docs/projects).

**Align:** Add project-team membership and a stable project ID on issues. Migrate string links, including duplicate names, before allowing multi-team projects. Compute project progress from linked issue IDs, not names.

### P1 — My issues “Subscribed” and “Activity” are inferred from unrelated facts

Our Subscribed tab includes issues assigned to the user **or with any comments**; Activity includes issues with any comments or Done status (`public/linear.js:92`). There is no subscription relation or per-user issue activity feed. Linear subscriptions are explicit and user-specific; its Activity tab is based on recent events, including creation, updates, status changes, comments, reactions, and PR activity. [Linear My issues](https://linear.app/docs/my-issues), [notifications](https://linear.app/docs/notifications).

**Align:** Persist subscribers and issue events. Derive both tabs from those relations, scoped to the current user. Stop using comments or Done as proxies.

### P1 — Guest navigation exposes workspace areas Linear excludes

The sidebar renders Members, Teams, Dashboards, Announcements, Applications, Requests, and Initiatives for every role (`public/linear.js:87`). The server filters some data, but guests can still reach these surfaces and can submit team requests and application requests (`app/api/records/route.ts:131-145`; `app/api/admin/route.ts:247-256`). Linear guests are limited to their teams' issues, projects, and documents and cannot view workspace-wide views, customer requests, initiatives, or administration settings. [Linear members and roles](https://linear.app/docs/members-roles).

**Align:** Define a guest route/navigation matrix and enforce it in APIs as well as the sidebar. Keep team collaboration actions that Linear permits; suppress workspace administration and cross-workspace surfaces.

### P2 — “Dashboards” is a fixed metrics page

Our Dashboards page always shows six counts and a team list (`public/linear.js:187-191`). Linear dashboards are user-created collections of Insights with configurable charts, tables, metrics, ownership, visibility, and filters. A static overview can be useful, but presenting it as the Dashboards feature gives users a different workflow. [Linear dashboards](https://linear.app/docs/dashboards).

**Align:** Either call the current page Overview or implement saved dashboards with Insight blocks and per-dashboard filters. Preserve the six counts as an optional starter dashboard.

### P2 — Cycles are arbitrary manually created date ranges

Our New cycle dialog takes a name, start, and end, then stores a `current` flag (`public/linear.js:125`; `app/api/records/route.ts:14,97-98`). Linear's cycles are enabled per team and generated from a repeating schedule; dates can be adjusted within constraints, and unfinished work rolls over automatically. [Linear cycles](https://linear.app/docs/use-cycles), [update cycles](https://linear.app/docs/update-cycles).

**Align:** Configure a team cadence and derive current/upcoming cycles from dates. Keep editing of allowed future/current dates and add rollover behavior. Remove free-form overlapping “current” cycles.

### P2 — Team owner must always exist

Our API refuses removal or demotion of the final team owner (`app/api/admin/route.ts:171-198`). Linear says a team is **not required** to have a team owner. This is a deliberate safety rule in our implementation, but it blocks a valid Linear state. [Linear members and roles](https://linear.app/docs/members-roles).

**Align:** Permit zero explicit team owners while preserving workspace admin/owner management rights. Re-evaluate any code that assumes a named owner before removing the invariant.

### P2 — Export is an owner-only raw JSON snapshot

Our Security page downloads one immediate JSON response containing members, invitations, settings, and all records (`app/api/export/route.ts`; `public/linear.js:215`). Linear's built-in workspace export is an asynchronous issue CSV, with separate member and view CSV exports and a private-team inclusion control. Linear's API can export additional data, but the in-product JSON snapshot is our own format. [Linear exporting data](https://linear.app/docs/exporting-data).

**Align:** Offer the documented CSV exports with matching access, filters, fields, and audit events. If raw JSON backup remains, label it as an additional backup tool and protect it separately.

### P2 — IP restriction accepts exact addresses only

Our setting compares `cf-connecting-ip` against an exact string list (`lib/workspace-server.ts:88-92`) and rejects slash notation (`app/api/admin/route.ts:221-225`). Linear supports individual IPs **and CIDR ranges**. [Linear login methods](https://linear.app/docs/login-methods).

**Align:** Parse and validate IPv4/IPv6 CIDR ranges, then evaluate the request address against them. Keep the current-IP lockout check using range membership.

### P2 — Announcements are a feed entry, not the full delivery workflow

Our app saves announcement records and renders them on an Announcements page (`app/api/admin/route.ts:233-245`; `public/linear.js:193-195`). Linear announcements are delivered to selected members' Inbox, email, and Slack when configured. [Linear workspaces](https://linear.app/docs/workspaces).

**Align:** Keep the authoring surface, but create audience-specific inbox notifications and add configured external delivery. Track delivery status so the page does not imply recipients were notified when they were not.

### P2 — Welcome message can be configured but is never shown

The Security page saves `welcomeMessage`, but the only application reads of that value are the settings form itself (`public/linear.js:207,235`; `app/api/admin/route.ts:208-229`). Linear shows the workspace welcome message to new members as part of onboarding. [Linear workspaces](https://linear.app/docs/workspaces).

**Align:** Present the message during first join/onboarding, track when each member has seen it, and provide an owner preview. Until then, the setting should not suggest that it reaches members.

### P2 — First visit imports a fixed demo workspace

The first owner visit imports `initial` when there is no previous browser demo data (`public/linear.js:16-41,311-320`), while `requireContext` creates a hard-coded Engineering team with an ENG counter starting at 127 (`lib/workspace-server.ts:63-69`). The live Site visibly contains the demo's 12 issues and five projects. Linear creates a default team named after the workspace, not a permanent Engineering fixture. [Linear workspaces](https://linear.app/docs/workspaces), [teams](https://linear.app/docs/teams).

**Align:** Make demo seeding opt-in and show a clear sample workspace state. For a new real workspace, create an empty default team with a configurable name/key and start its issue counter at 1. Do not mix imported demo records with production work.

### P2 — Triage is always a global selectable status

`Triage` is in the one global issue status set (`app/api/records/route.ts:9`), and the UI's standard status menu offers it across teams (`public/linear.js:9,95`). Linear Triage is an opt-in team inbox/status category; issues in Triage are excluded from ordinary views by default, and accepting or declining moves the issue through its lifecycle. [Linear Triage](https://linear.app/docs/triage), [issue status](https://linear.app/docs/configuring-workflows).

**Align:** Make Triage a team feature, not a universally available ordinary status. Add its queue and lifecycle actions, and use Linear's default view exclusion behavior.

## Platform-specific behavior to retain carefully

The rebuild currently requires ChatGPT Site sign-in plus an independent Site access allowlist, then an in-app invitation (`app/chatgpt-auth.ts`; `lib/workspace-server.ts:50-95`). Linear supports Google, email, passkey, and SAML sign-in and can use JIT/SCIM provisioning. The two-gate access flow is a hosting constraint, not a Linear workflow. Keep it explicit until a compatible identity boundary replaces it. [Linear login methods](https://linear.app/docs/login-methods), [invite members](https://linear.app/docs/invite-members).

## Features that are real Linear concepts

Five-level sub-teams, restricted/private sub-teams, workspace announcements, a default home/welcome message, guest and team-owner roles, third-party app approvals, Dashboards, IP restrictions, and workspace export are all documented Linear features. The findings above concern their current **semantics and workflow**, so these concepts should be corrected rather than removed wholesale.

## Recommended correction order

1. **Protect data:** Fix private-team access and introduce recoverable deletion before adding more users or migrating valuable work.
2. **Repair the domain model:** Migrate Requests to issues/Triage, projects to stable multi-team relations, and sub-team membership/visibility to Linear's rules.
3. **Repair misleading labels:** Make My issues subscriptions/activity real; rename the fixed metrics page until Dashboards is implemented; distinguish app suggestions from OAuth approvals.
4. **Match administration:** Correct approved-domain semantics, guest navigation, team-owner rules, CIDR handling, announcements, export, and cycle cadence.
5. **Remove demo assumptions:** Make sample data opt-in and use the workspace's own team identity at bootstrap.

Each item should have a role-matrix or workflow test comparing the same scenario with Linear's documented behavior. The source and deployed UI were inspected; the owner-only live Site prevented exercising multi-user production paths, so those findings rely on server code and local tests from the implementation work.
