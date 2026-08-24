ALTER TABLE `screener_snapshot_generations` ADD `filter_mask_schema_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `screener_snapshot_generations` ADD `client_payload_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `screener_snapshot_generations` ADD `client_payload_etag` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `screener_snapshot_generations`
SET `filter_mask_schema_version` = 1
WHERE `filter_mask_schema_version` = 0;
