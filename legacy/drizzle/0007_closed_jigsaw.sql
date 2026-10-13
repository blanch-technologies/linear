CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scope` text DEFAULT 'read write' NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL
);
