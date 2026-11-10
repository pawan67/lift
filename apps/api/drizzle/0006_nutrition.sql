CREATE TABLE "custom_nutrients" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"meal" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"quantity" double precision NOT NULL,
	"food_id" text,
	"name" text NOT NULL,
	"brand" text,
	"serving_label" text NOT NULL,
	"serving_grams" double precision,
	"nutrients" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"source" text NOT NULL,
	"source_id" text,
	"servings" jsonb NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"meal" text,
	"items" jsonb NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_goals" (
	"user_id" text PRIMARY KEY NOT NULL,
	"targets" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_nutrients" ADD CONSTRAINT "custom_nutrients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_goals" ADD CONSTRAINT "nutrition_goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_nutrients_user_idx" ON "custom_nutrients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "food_entries_day_idx" ON "food_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "food_entries_recent_idx" ON "food_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "food_entries_food_idx" ON "food_entries" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "foods_user_idx" ON "foods" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_idx" ON "foods" USING btree ("user_id","source","source_id");--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("user_id","barcode");--> statement-breakpoint
CREATE INDEX "meal_templates_user_idx" ON "meal_templates" USING btree ("user_id");