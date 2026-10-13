CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`owner_user_id` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`credentials_json` text DEFAULT '{}' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_deliveries` (
	`provider` text NOT NULL,
	`delivery_id` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`provider`, `delivery_id`)
);
--> statement-breakpoint
CREATE TABLE `integration_links` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`issue_id` text,
	`project_id` text,
	`kind` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
