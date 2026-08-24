CREATE TABLE `screener_snapshot_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`universe_refreshed_at` integer NOT NULL,
	`refreshed_at` integer NOT NULL,
	`row_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "screener_snapshot_generations_row_count_check" CHECK("screener_snapshot_generations"."row_count" between 1 and 1000)
);
--> statement-breakpoint
CREATE INDEX `screener_snapshot_generations_created_idx` ON `screener_snapshot_generations` (`created_at`);--> statement-breakpoint
CREATE TABLE `screener_snapshot_rows` (
	`generation_id` text NOT NULL,
	`market_code` text NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`generation_id`, `market_code`),
	FOREIGN KEY (`generation_id`) REFERENCES `screener_snapshot_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "screener_snapshot_rows_payload_check" CHECK(json_valid("screener_snapshot_rows"."payload_json"))
);
--> statement-breakpoint
CREATE TABLE `screener_snapshot_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_generation_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_generation_id`) REFERENCES `screener_snapshot_generations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "screener_snapshot_state_singleton_check" CHECK("screener_snapshot_state"."id" = 1)
);
