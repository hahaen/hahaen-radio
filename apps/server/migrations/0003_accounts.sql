CREATE TABLE `account_libraries` (
	`user_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	`collection` json NOT NULL,
	CONSTRAINT `account_libraries_user_id` PRIMARY KEY(`user_id`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `account_sessions_token_hash` PRIMARY KEY(`token_hash`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE `account_users` (
	`id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`username` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`password_hash` varchar(192) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `account_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_users_username_idx` UNIQUE(`username`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
--> statement-breakpoint
ALTER TABLE `account_libraries` ADD CONSTRAINT `account_libraries_user_id_account_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `account_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_sessions` ADD CONSTRAINT `account_sessions_user_id_account_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `account_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_sessions_expiry_idx` ON `account_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `account_sessions_user_idx` ON `account_sessions` (`user_id`);