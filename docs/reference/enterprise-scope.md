# Enterprise scope and delivery status

Reference: [Linear's Enterprise pricing and feature comparison](https://linear.app/pricing), checked October 12, 2026. This is the implementation map for the rebuild. It does not claim full product parity.

| Area | Implemented in this rebuild | Remaining for equivalent Enterprise behavior |
| --- | --- | --- |
| Core work | Shared issues, multi-team projects with stable links, initiatives, issue-based Ask intake and Triage, generated team cycles, views, comments, subscriptions, search/filter/board, attachments, recoverable deletion, inbox notifications, background CSV export jobs | Sub-initiatives, external Asks conversations, triage rules, releases, SLAs, templates, estimates, dependencies, bulk operations, richer history, general migration imports, complete file exports |
| Organization | Multiple teams, private/restricted/public visibility, five-level nesting, parent membership and inherited management, owner/admin/member/guest roles, teams with zero explicit owners | Complete migration of older unusual team hierarchies, workspace group synchronization |
| Administration | Invitations tied to authenticated email with revocation, member suspension and role changes, announcements sent to inbox, configurable invitation and team creation policies, default home, welcome onboarding, app suggestions | Invitation email delivery, site access automation, real OAuth app approvals, verified-domain self-join, email/Slack announcement delivery |
| Identity | Private Site sign-in and server-side membership checks | Google/SAML SSO, SCIM provisioning, verified domain claiming, provider-based login restrictions |
| Security | IPv4/IPv6 CIDR allowlist, version-checked writes, explicit private-team membership for content, guest enforcement, owner audit view, attachment authorization | Verified IdP login enforcement, broader audit event coverage/retention management, security review and formal compliance controls |
| Reporting | Live workspace overview, saved Dashboards with metric/chart/table Insights and team/status filters, ID-based project progress | Advanced Insights calculations, sharing controls, and progress reports |
| Developer workflows | Internal authenticated API; GitHub App installation flow, PR/commit links, PR status automation, mapped GitHub Issues and comment sync after provider setup | Public API credentials, outbound webhooks, code intelligence, Diffs, agentic coding |
| AI and agents | None | Agent platform, Linear Agent, Loops, Triage Intelligence, permission and usage controls |
| Integrations | App suggestions; encrypted Slack, GitHub, and Notion OAuth connection layer; signed Slack/GitHub webhook gateway source; mapped Slack issue creation, thread replies, app updates and public issue unfurls; mapped GitHub event processing | Developer apps, gateway deployment and credentials; Notion partner approval for native previews; Slack personal and project notifications; GitHub advanced coding workflows; other provider connections |

The Site's current visitor access policy is custom and owner-only. The app supports multiple members, but each additional visitor must also be admitted by the Site access policy. `BOOTSTRAP_OWNER_EMAIL` is configured for the intended owner before access is widened. SAML and SCIM cannot be considered operational until a provider is selected and the hosted identity boundary supports that provider.

Invoice/PO billing, migration and onboarding support, priority support, account management, custom terms, uptime SLA, and a HIPAA BAA require business operations, contractual commitments, and infrastructure assurance. Application screens cannot supply those commitments.

## Verification performed

- TypeScript, browser JavaScript syntax, and production worker build pass.
- Local D1 migrations applied successfully.
- Local integration checks covered unauthenticated and uninvited denial, member invitation and activation, private team visibility, guest access, unauthorized writes, concurrent edit rejection, last-workspace-owner protection, and audit output. A new admin role matrix verified private issues and CSV exports before joining, after joining, and after leaving the team.
- Browser QA covered issue creation, comments, member/team/security screens, initiatives, requests, and attachment rendering. Local R2 upload/download was verified; a guest from another team received 403 for the file.
- Initiative-to-project relationships, issue-based Ask intake, Triage acceptance, recurring cycle generation, cross-team project links through a rename, and delete/restore passed local integration checks.
- Zero explicit team owners are permitted while workspace admins retain management rights. Invitation revocation succeeded for the inviter and denied an unrelated member.

## Sources

- [Enterprise feature comparison](https://linear.app/pricing)
- [Members and roles](https://linear.app/docs/members-roles)
- [SAML and access control](https://linear.app/docs/saml-and-access-control)
- [SCIM](https://linear.app/docs/scim)
- [Audit log](https://linear.app/docs/audit-log)
- [Login methods and IP restrictions](https://linear.app/docs/login-methods)
- [Workspace onboarding and announcements](https://linear.app/docs/workspaces)
