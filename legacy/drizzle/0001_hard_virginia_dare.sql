CREATE TABLE `team_counters` (
	`team_id` text PRIMARY KEY NOT NULL,
	`next_issue_number` integer DEFAULT 1 NOT NULL
);
