CREATE TABLE `issue_events` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`team_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_subscriptions` (
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `project_teams` (
	`project_id` text NOT NULL,
	`team_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `team_id`)
);
--> statement-breakpoint
ALTER TABLE `members` ADD `welcome_seen_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `triage_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `cycle_duration_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `cycle_start_date` text;