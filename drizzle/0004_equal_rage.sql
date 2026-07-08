CREATE TABLE "context_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"tokens" integer NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"superseded_by" uuid,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"phase_type" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"max_tokens" integer NOT NULL,
	"fallback_model" text,
	"web_search" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_superseded_by_context_items_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."context_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_items_live_idx" ON "context_items" USING btree ("project_id","kind") WHERE superseded_by is null;