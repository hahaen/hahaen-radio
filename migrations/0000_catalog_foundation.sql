CREATE TABLE `catalog_entries` (
	`version_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`station_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`observed` boolean NOT NULL,
	`payload` json NOT NULL,
	CONSTRAINT `catalog_entries_version_id_station_id_pk` PRIMARY KEY(`version_id`,`station_id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_head` (
	`id` int NOT NULL,
	`version_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	CONSTRAINT `catalog_head_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_versions` (
	`id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`manifest` json NOT NULL,
	`source_count` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	CONSTRAINT `catalog_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_leases` (
	`name` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `job_leases_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`processed_count` int NOT NULL DEFAULT 0,
	`error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` int unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`ascii_name` varchar(255) NOT NULL,
	`aliases` text NOT NULL,
	`country_code` varchar(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`timezone` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`imported_at` datetime(3) NOT NULL,
	CONSTRAINT `places_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `station_overrides` (
	`station_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`blocked` boolean NOT NULL,
	`reason` varchar(255) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `station_overrides_station_id` PRIMARY KEY(`station_id`)
);
--> statement-breakpoint
CREATE TABLE `station_registry` (
	`id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload` json NOT NULL,
	`last_seen_version` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`missing_count` int NOT NULL DEFAULT 0,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `station_registry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `catalog_entries` ADD CONSTRAINT `catalog_entries_version_id_catalog_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `catalog_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_head` ADD CONSTRAINT `catalog_head_version_id_catalog_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `catalog_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `places_country_idx` ON `places` (`country_code`);