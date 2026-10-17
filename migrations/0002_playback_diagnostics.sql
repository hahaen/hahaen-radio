CREATE TABLE `diagnostic_limits` (
	`id` int unsigned NOT NULL,
	`period_day` varchar(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`accepted_count` int unsigned NOT NULL,
	`next_slot` int unsigned NOT NULL,
	CONSTRAINT `diagnostic_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `diagnostic_limits_singleton` CHECK(`diagnostic_limits`.`id` = 1),
	CONSTRAINT `diagnostic_limits_count` CHECK(`diagnostic_limits`.`accepted_count` <= 1000),
	CONSTRAINT `diagnostic_limits_slot` CHECK(`diagnostic_limits`.`next_slot` < 10000)
);
--> statement-breakpoint
CREATE TABLE `playback_reports` (
	`slot` int unsigned NOT NULL,
	`report_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`station_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`stream_id` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`failure` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `playback_reports_slot` PRIMARY KEY(`slot`),
	CONSTRAINT `playback_reports_receipt_idx` UNIQUE(`report_id`),
	CONSTRAINT `playback_reports_slot_bound` CHECK(`playback_reports`.`slot` < 10000),
	CONSTRAINT `playback_reports_failure` CHECK(`playback_reports`.`failure` IN ('network', 'timeout', 'unsupported', 'unavailable', 'offline')),
	CONSTRAINT `playback_reports_validity` CHECK(`playback_reports`.`expires_at` > `playback_reports`.`created_at` AND `playback_reports`.`expires_at` <= DATE_ADD(`playback_reports`.`created_at`, INTERVAL 7 DAY))
);
--> statement-breakpoint
CREATE INDEX `playback_reports_expiry_idx` ON `playback_reports` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `diagnostic_limits` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `playback_reports` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
INSERT INTO `diagnostic_limits` (`id`, `period_day`, `accepted_count`, `next_slot`) VALUES (1, '1970-01-01', 0, 0);
