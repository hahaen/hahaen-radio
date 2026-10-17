ALTER TABLE `catalog_entries` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `catalog_head` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `catalog_versions` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `job_leases` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `job_runs` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `places` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC,
  MODIFY `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  MODIFY `ascii_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  MODIFY `aliases` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
--> statement-breakpoint
ALTER TABLE `station_overrides` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC,
  MODIFY `reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
--> statement-breakpoint
ALTER TABLE `station_registry` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
ALTER TABLE `__drizzle_migrations` ENGINE=InnoDB, DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, ROW_FORMAT=DYNAMIC,
  MODIFY `hash` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
