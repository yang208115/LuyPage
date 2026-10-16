CREATE TABLE `auth_identities` (
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`owner_id` text NOT NULL,
	`display_name` text NOT NULL,
	PRIMARY KEY(`provider`, `issuer`, `subject`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_identities_owner` ON `auth_identities` (`owner_id`);--> statement-breakpoint
CREATE TABLE `bookmark_tags` (
	`owner_id` text NOT NULL,
	`bookmark_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `bookmark_id`, `tag_id`),
	FOREIGN KEY (`owner_id`,`bookmark_id`) REFERENCES `bookmarks`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`tag_id`) REFERENCES `tags`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmark_tags_tag` ON `bookmark_tags` (`owner_id`,`tag_id`,`bookmark_id`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`note` text NOT NULL,
	`search_key` text NOT NULL,
	`group_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`pinned_position` integer NOT NULL,
	`icon_type` text NOT NULL,
	`icon_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`group_id`) REFERENCES `groups`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookmark_version_positive" CHECK("bookmarks"."version" > 0),
	CONSTRAINT "pinned_boolean" CHECK("bookmarks"."pinned" IN (0, 1)),
	CONSTRAINT "icon_type_valid" CHECK("bookmarks"."icon_type" IN ('auto', 'builtin')),
	CONSTRAINT "bookmark_position_safe" CHECK("bookmarks"."position" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "pinned_position_safe" CHECK("bookmarks"."pinned_position" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `bookmarks_group_order` ON `bookmarks` (`owner_id`,`deleted_at`,`group_id`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `bookmarks_pinned_order` ON `bookmarks` (`owner_id`,`deleted_at`,`pinned`,`pinned_position`,`id`);--> statement-breakpoint
CREATE INDEX `bookmarks_created` ON `bookmarks` (`owner_id`,`deleted_at`,`pinned`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `bookmarks_updated` ON `bookmarks` (`owner_id`,`deleted_at`,`pinned`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `bookmarks_title` ON `bookmarks` (`owner_id`,`deleted_at`,`pinned`,`title_key`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_owner_id_normalized_url_unique` ON `bookmarks` (`owner_id`,`normalized_url`);--> statement-breakpoint
CREATE TABLE `groups` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "group_version_positive" CHECK("groups"."version" > 0),
	CONSTRAINT "group_position_safe" CHECK("groups"."position" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `groups_order` ON `groups` (`owner_id`,`position`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_owner_id_name_key_unique` ON `groups` (`owner_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `mutation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`passed` integer NOT NULL,
	CONSTRAINT "guard_passed" CHECK("mutation_guards"."passed" = 1)
);
--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "receipt_json" CHECK(json_valid("mutation_receipts"."response_json"))
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tag_version_positive" CHECK("tags"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_owner_id_name_key_unique` ON `tags` (`owner_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`data_revision` integer DEFAULT 0 NOT NULL,
	`preferences` text DEFAULT '{"desktopColumns":"auto","mobileColumns":"auto","density":"comfortable","collapsedGroupIds":[],"autoIcons":false}' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revision_nonnegative" CHECK("workspace_state"."data_revision" >= 0),
	CONSTRAINT "preferences_json" CHECK(json_valid("workspace_state"."preferences"))
);
