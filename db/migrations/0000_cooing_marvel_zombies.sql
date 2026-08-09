CREATE TYPE "public"."account_status" AS ENUM('active', 'frozen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit_card', 'cash', 'investment');--> statement-breakpoint
CREATE TYPE "public"."balance_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."entry_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('posted', 'void');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('deposit', 'withdrawal', 'transfer', 'fee', 'reversal');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_number" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "account_type" DEFAULT 'checking' NOT NULL,
	"normal_side" "balance_side" DEFAULT 'debit' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"overdraft_limit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"current_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_number_unique" UNIQUE("account_number"),
	CONSTRAINT "accounts_overdraft_limit_non_negative" CHECK ("accounts"."overdraft_limit" >= 0),
	CONSTRAINT "accounts_currency_iso" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"direction" "entry_direction" NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_amount_positive" CHECK ("entries"."amount" > 0),
	CONSTRAINT "entries_currency_iso" CHECK ("entries"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"balance" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(64),
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'posted' NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_account_seq_unique" ON "entries" USING btree ("account_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_transaction_account_unique" ON "entries" USING btree ("transaction_id","account_id");--> statement-breakpoint
CREATE INDEX "entries_account_seq_idx" ON "entries" USING btree ("account_id","seq");--> statement-breakpoint
CREATE INDEX "entries_transaction_idx" ON "entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_account_seq_unique" ON "snapshots" USING btree ("account_id","seq");