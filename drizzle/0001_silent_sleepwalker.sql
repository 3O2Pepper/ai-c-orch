ALTER TABLE "model_calls" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "budget_usd" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "budget_usd" SET DEFAULT '5';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "spent_usd" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "spent_usd" SET DEFAULT '0';