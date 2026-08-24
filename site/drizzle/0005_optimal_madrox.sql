CREATE TABLE `screener_snapshot_daily_runs` (
	`trading_date` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`generation_id` text,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`lease_token` text NOT NULL,
	`error_message` text,
	FOREIGN KEY (`generation_id`) REFERENCES `screener_snapshot_generations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "screener_snapshot_daily_runs_date_check" CHECK("screener_snapshot_daily_runs"."trading_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "screener_snapshot_daily_runs_attempt_check" CHECK("screener_snapshot_daily_runs"."attempt_count" >= 1),
	CONSTRAINT "screener_snapshot_daily_runs_status_check" CHECK("screener_snapshot_daily_runs"."status" in ('running', 'complete', 'failed')),
	CONSTRAINT "screener_snapshot_daily_runs_completion_check" CHECK((
        ("screener_snapshot_daily_runs"."status" = 'running' and "screener_snapshot_daily_runs"."completed_at" is null and "screener_snapshot_daily_runs"."generation_id" is null)
        or ("screener_snapshot_daily_runs"."status" = 'complete' and "screener_snapshot_daily_runs"."completed_at" is not null)
        or ("screener_snapshot_daily_runs"."status" = 'failed' and "screener_snapshot_daily_runs"."completed_at" is not null and "screener_snapshot_daily_runs"."generation_id" is null)
      ))
);
--> statement-breakpoint
CREATE INDEX `screener_snapshot_daily_runs_status_idx` ON `screener_snapshot_daily_runs` (`status`,`started_at`);