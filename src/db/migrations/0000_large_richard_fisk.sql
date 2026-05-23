CREATE TABLE IF NOT EXISTS "ad_takedowns" (
	"job_id" text PRIMARY KEY NOT NULL,
	"ad_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
