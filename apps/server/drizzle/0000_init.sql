CREATE TABLE `ai_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`meal_id` integer,
	`kind` text DEFAULT 'estimate' NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` integer,
	`model` text,
	`exit_code` integer,
	`output_json` text,
	`error` text,
	`calibration_error_pct` real,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_runs_meal` ON `ai_runs` (`meal_id`);--> statement-breakpoint
CREATE TABLE `body_logs` (
	`profile_id` text NOT NULL,
	`date` text NOT NULL,
	`weight_kg` real,
	`neck_cm` real,
	`waist_cm` real,
	`hip_cm` real,
	PRIMARY KEY(`profile_id`, `date`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meal_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meal_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`portion` text DEFAULT '' NOT NULL,
	`grams` real NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`confidence` text,
	`source` text NOT NULL,
	`my_food_id` integer,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`my_food_id`) REFERENCES `my_foods`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `meal_items_meal` ON `meal_items` (`meal_id`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`eaten_at` text NOT NULL,
	`eaten_date` text NOT NULL,
	`slot` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`photo_path` text,
	`status` text NOT NULL,
	`shared_group_id` text,
	`portion` real DEFAULT 1 NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`answers` text DEFAULT '[]' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`calibration` integer DEFAULT false NOT NULL,
	`true_kcal` real,
	`true_protein_g` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meals_profile_date` ON `meals` (`profile_id`,`eaten_date`);--> statement-breakpoint
CREATE INDEX `meals_status` ON `meals` (`status`);--> statement-breakpoint
CREATE INDEX `meals_group` ON `meals` (`shared_group_id`);--> statement-breakpoint
CREATE TABLE `my_foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`serving_desc` text NOT NULL,
	`serving_g` real NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `my_foods_profile` ON `my_foods` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text NOT NULL,
	`sex` text NOT NULL,
	`birth_date` text NOT NULL,
	`height_cm` real NOT NULL,
	`activity` text NOT NULL,
	`job_type` text NOT NULL,
	`workouts_per_week` integer NOT NULL,
	`goal` text NOT NULL,
	`goal_weight_kg` real,
	`pace_kg_week` real NOT NULL,
	`diet_flags` text NOT NULL,
	`meal_slots` text NOT NULL,
	`special_status` text DEFAULT 'none' NOT NULL,
	`ai_access` text NOT NULL,
	`pin_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recaps` (
	`profile_id` text NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`text` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`profile_id`, `month`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reference_foods` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`search_text` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`serving_desc` text,
	`serving_g` real
);
--> statement-breakpoint
CREATE INDEX `reference_foods_name` ON `reference_foods` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`source` text NOT NULL,
	`basis_weight_kg` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `targets_profile_from` ON `targets` (`profile_id`,`effective_from`);