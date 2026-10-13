CREATE TABLE `issue_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_statuses_team_name_unique` ON `issue_statuses` (`team_id`,`name`);
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':backlog', id, 'Backlog', 'backlog', 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':todo', id, 'Todo', 'unstarted', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':in-progress', id, 'In Progress', 'started', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':done', id, 'Done', 'completed', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':canceled', id, 'Canceled', 'canceled', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
INSERT INTO issue_statuses (id, team_id, name, category, position, is_default, created_at, updated_at) SELECT id || ':duplicate', id, 'Duplicate', 'duplicate', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams;
--> statement-breakpoint
