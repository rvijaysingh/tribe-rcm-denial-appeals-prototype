-- pgvector must exist before any vector(1024) column is created.
-- drizzle-kit does not emit this; it is added by hand and must be kept on
-- regeneration of this first migration.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."condition" AS ENUM('chf_exacerbation', 'sepsis', 'copd_exacerbation', 'pneumonia');--> statement-breakpoint
CREATE TYPE "public"."criteria_style" AS ENUM('interqual_style', 'mcg_style');--> statement-breakpoint
CREATE TYPE "public"."denial_category" AS ENUM('medical_necessity', 'level_of_care');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('hp', 'progress', 'discharge');--> statement-breakpoint
CREATE TYPE "public"."payer_id" AS ENUM('meridian', 'cascade', 'northgate');--> statement-breakpoint
CREATE TYPE "public"."precedent_outcome" AS ENUM('overturned', 'upheld');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('approve', 'edit', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."root_cause" AS ENUM('severity_not_documented', 'criteria_not_met_at_admission', 'treatment_appropriate_at_lower_level', 'los_exceeds_expected');--> statement-breakpoint
CREATE TYPE "public"."route" AS ENUM('ready', 'needs_review', 'needs_docs', 'do_not_appeal');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."split" AS ENUM('dev', 'test', 'demo');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('a_triage', 'b_classify', 'c_retrieve', 'd_draft', 'e_verify');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"mrn" text NOT NULL,
	"patient_age" integer NOT NULL,
	"admit_date" timestamp with time zone NOT NULL,
	"discharge_date" timestamp with time zone NOT NULL,
	"drg" text NOT NULL,
	"condition" "condition" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "chart_lines_doc_line_uq" UNIQUE("doc_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "criteria_clauses" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"code" text NOT NULL,
	"text" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "criteria_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" "payer_id" NOT NULL,
	"condition" "condition" NOT NULL,
	"version" text NOT NULL,
	CONSTRAINT "criteria_sets_payer_condition_uq" UNIQUE("payer_id","condition")
);
--> statement-breakpoint
CREATE TABLE "denials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"payer_id" "payer_id" NOT NULL,
	"category" "denial_category" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"received_date" timestamp with time zone NOT NULL,
	"carc" text NOT NULL,
	"rarc" text NOT NULL,
	"letter_text" text NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"split" "split" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"split" "split" NOT NULL,
	"case_count" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model_set" text NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"per_case_json" jsonb NOT NULL,
	"reference" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ground_truth" (
	"denial_id" text PRIMARY KEY NOT NULL,
	"category" "denial_category" NOT NULL,
	"root_cause" "root_cause" NOT NULL,
	"met_clause_ids" jsonb NOT NULL,
	"unmet_required_clause_ids" jsonb NOT NULL,
	"expected_route" "route" NOT NULL,
	"winnable" boolean NOT NULL,
	"approve_as_is" boolean NOT NULL,
	"spot_checked" boolean DEFAULT false NOT NULL,
	"spot_check_note" text
);
--> statement-breakpoint
CREATE TABLE "payer_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" "payer_id" NOT NULL,
	"condition" "condition" NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" "payer_id" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"criteria_style" "criteria_style" NOT NULL,
	"deadline_days" integer NOT NULL,
	"appeal_format_notes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"denial_id" text NOT NULL,
	"status" "run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_ms" integer,
	"total_cost" numeric(10, 6),
	"route" "route",
	"route_reason" text,
	"prompt_version" text NOT NULL,
	"model_set" text NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "precedent_appeals" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" "payer_id" NOT NULL,
	"category" "denial_category" NOT NULL,
	"condition" "condition" NOT NULL,
	"summary" text NOT NULL,
	"outcome" "precedent_outcome" NOT NULL,
	"letter_excerpt" text NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "reviewer_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action" "review_action" NOT NULL,
	"edited_text" text,
	"diff_json" jsonb,
	"reason" text,
	"reviewer_minutes" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage" "stage" NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"ms" integer NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stage_outputs_run_stage_uq" UNIQUE("run_id","stage")
);
--> statement-breakpoint
ALTER TABLE "chart_docs" ADD CONSTRAINT "chart_docs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_lines" ADD CONSTRAINT "chart_lines_doc_id_chart_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."chart_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_clauses" ADD CONSTRAINT "criteria_clauses_set_id_criteria_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."criteria_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_sets" ADD CONSTRAINT "criteria_sets_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denials" ADD CONSTRAINT "denials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denials" ADD CONSTRAINT "denials_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ground_truth" ADD CONSTRAINT "ground_truth_denial_id_denials_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_notes" ADD CONSTRAINT "payer_notes_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_denial_id_denials_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precedent_appeals" ADD CONSTRAINT "precedent_appeals_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_feedback" ADD CONSTRAINT "reviewer_feedback_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chart_docs_account_idx" ON "chart_docs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "chart_lines_doc_idx" ON "chart_lines" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "criteria_clauses_set_idx" ON "criteria_clauses" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "criteria_clauses_embedding_idx" ON "criteria_clauses" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "denials_split_idx" ON "denials" USING btree ("split");--> statement-breakpoint
CREATE INDEX "denials_payer_idx" ON "denials" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "payer_notes_payer_condition_idx" ON "payer_notes" USING btree ("payer_id","condition");--> statement-breakpoint
CREATE INDEX "payer_notes_embedding_idx" ON "payer_notes" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "pipeline_runs_denial_idx" ON "pipeline_runs" USING btree ("denial_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "precedent_appeals_filter_idx" ON "precedent_appeals" USING btree ("payer_id","category","outcome");--> statement-breakpoint
CREATE INDEX "precedent_appeals_embedding_idx" ON "precedent_appeals" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "reviewer_feedback_run_idx" ON "reviewer_feedback" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "stage_outputs_run_idx" ON "stage_outputs" USING btree ("run_id");