CREATE TABLE `anonymous_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "anonymous_sessions_expiry_check" CHECK("anonymous_sessions"."expires_at" > "anonymous_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `anonymous_sessions_expires_at_idx` ON `anonymous_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `saved_screener_baseline_symbols` (
	`screener_id` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`screener_id`, `symbol`),
	FOREIGN KEY (`screener_id`) REFERENCES `saved_screeners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_screener_baseline_symbol_idx` ON `saved_screener_baseline_symbols` (`symbol`);--> statement-breakpoint
CREATE TABLE `saved_screeners` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`filters_json` text NOT NULL,
	`columns_json` text NOT NULL,
	`sort_key` text NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`baseline_captured_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `anonymous_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "saved_screeners_sort_order_check" CHECK("saved_screeners"."sort_order" in ('asc', 'desc'))
);
--> statement-breakpoint
CREATE INDEX `saved_screeners_session_updated_idx` ON `saved_screeners` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `security_journal` (
	`session_id` text NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sentiment` text DEFAULT 'neutral' NOT NULL,
	`watch_price` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `exchange`, `symbol`),
	FOREIGN KEY (`session_id`) REFERENCES `anonymous_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "security_journal_sentiment_check" CHECK("security_journal"."sentiment" in ('bear', 'neutral', 'bull')),
	CONSTRAINT "security_journal_watch_price_check" CHECK("security_journal"."watch_price" is null or "security_journal"."watch_price" > 0)
);
--> statement-breakpoint
CREATE INDEX `security_journal_session_updated_idx` ON `security_journal` (`session_id`,`updated_at`);