CREATE TABLE `top_market_cap_universe` (
	`market_code` text PRIMARY KEY NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`market_cap` real NOT NULL,
	`market_rank` integer NOT NULL,
	`refreshed_at` integer NOT NULL,
	CONSTRAINT "top_market_cap_universe_rank_check" CHECK("top_market_cap_universe"."market_rank" between 1 and 1000),
	CONSTRAINT "top_market_cap_universe_market_cap_check" CHECK("top_market_cap_universe"."market_cap" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `top_market_cap_universe_rank_idx` ON `top_market_cap_universe` (`market_rank`);