ALTER TABLE "account_plans" DROP CONSTRAINT "account_plans_name_unique";--> statement-breakpoint
ALTER TABLE "user_plans" DROP CONSTRAINT "user_plans_name_unique";--> statement-breakpoint
ALTER TABLE "account_plans" ADD COLUMN "owner_account_id" uuid;--> statement-breakpoint
ALTER TABLE "user_plans" ADD COLUMN "owner_account_id" uuid;--> statement-breakpoint
ALTER TABLE "user_plans" ADD COLUMN "is_built_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_plan_owner_name_unique" ON "account_plans" USING btree ("owner_account_id","name") WHERE "account_plans"."owner_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_plan_builtin_name_unique" ON "account_plans" USING btree ("name") WHERE "account_plans"."is_built_in" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "user_plan_owner_name_unique" ON "user_plans" USING btree ("owner_account_id","name") WHERE "user_plans"."owner_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_plan_builtin_name_unique" ON "user_plans" USING btree ("name") WHERE "user_plans"."is_built_in" = true;--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plan_owner_check" CHECK (("account_plans"."is_built_in" = true AND "account_plans"."owner_account_id" IS NULL)
                OR
                ("account_plans"."is_built_in" = false AND "account_plans"."owner_account_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plan_limits_check" CHECK ("account_plans"."monthly_allowance" > 0 AND "account_plans"."max_units_per_request" > 0);--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plan_owner_check" CHECK (("user_plans"."is_built_in" = true AND "user_plans"."owner_account_id" IS NULL)
                OR
                ("user_plans"."is_built_in" = false AND "user_plans"."owner_account_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plan_limits_check" CHECK ("user_plans"."monthly_allowance" > 0 AND "user_plans"."max_units_per_request" > 0);