CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS trigger LANGUAGE "plpgsql" AS $$BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;$$;--> statement-breakpoint
CREATE TRIGGER "accounts_set_updated_at" BEFORE UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
