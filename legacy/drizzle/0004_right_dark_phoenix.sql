CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`include_private` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`storage_key` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
