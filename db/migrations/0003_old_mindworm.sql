CREATE TYPE "public"."account_event_type" AS ENUM('account_opened', 'account_frozen', 'account_reactivated', 'account_closed', 'limit_changed');--> statement-breakpoint
CREATE TABLE "account_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"type" "account_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_events" ADD CONSTRAINT "account_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_events_account_seq_unique" ON "account_events" USING btree ("account_id","seq");--> statement-breakpoint
CREATE INDEX "account_events_account_seq_idx" ON "account_events" USING btree ("account_id","seq");