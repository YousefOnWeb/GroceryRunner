DROP TABLE IF EXISTS `tasks`;
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`personId` text,
	`targetDate` text,
	`targetTime` text,
	`locationPlace` text,
	`notificationId` text,
	`isCompleted` integer DEFAULT false NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`personId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);