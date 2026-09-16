# CLAUDE.md

## Purpose

Demo prototype of a GenAI clinical denial appeals assistant for a large healthcare revenue cycle management (RCM) operator. It is shown live in a case-presentation interview. A mock billing workqueue runs a five-stage pipeline (rules plus LLM) that drafts a fully cited appeal letter and routes it to a nurse reviewer who approves, edits, or escalates. Nothing auto-submits.

Synthetic data only. No PHI. No real client names anywhere in code, data, or docs.

Full spec: `docs/PRD.md`. Read the relevant section before building any feature. If the PRD is silent or contradicts itself, ask before guessing.

## Stack

- Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4
- shadcn/ui on Radix primitives (style `radix-nova`, base color neutral, lucide icons); components in `src/components/ui`
- Postgres 18 with pgvector 0.8 on Railway; Drizzle ORM with the `postgres` driver
- Anthropic SDK. Model IDs live only in `src/lib/models.ts`
- Voyage AI embeddings via fetch (`voyage-3.5`, 1024 dims)
- Vitest for tests, tsx for scripts
- Deploy: push to `main`, Railway auto-deploys. Local dev uses the public DB URL in `.env.local`

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | local dev server |
| `npm run build` / `typecheck` / `lint` / `test` | all four must pass before every commit |
| `npm run db:generate` | drizzle-kit generate a migration from schema changes |
| `npm run db:push` | apply schema to `DATABASE_URL` |
| `npm run db:seed` | regenerate and load synthetic data, idempotent, embeds criteria and precedents |
| `npm run pipeline -- --case <id>` | run the pipeline on one case from the CLI, persist the run |
| `npm run eval` | run the eval harness on the test split, write an EvalRun |
| `npm run demo:reset -- --case <id>` | delete runs and feedback for a demo case so it can be run live again |

## Architecture map

```
src/app/(workqueue)/      workqueue list, account detail, RN review panel
src/app/dashboard/        metrics dashboard and eval dashboard
src/app/api/              route handlers: run pipeline (SSE streaming), feedback, reset
src/lib/pipeline/         a-triage.ts, b-classify.ts, c-retrieve.ts, d-draft.ts, e-verify.ts, orchestrator.ts
src/lib/prompts/          prompt templates, one file per prompt, version in filename
src/lib/db/               drizzle schema, client, typed queries
src/lib/models.ts         model IDs, embedding config, price table (single source of truth)
src/lib/economics.ts      triage constants: cost per appeal, thresholds, win-rate table
src/lib/render/           deterministic letter renderer from structured draft JSON
scripts/seed/             synthetic data generation, passes A to E
scripts/eval/             harness and metric functions
docs/                     PRD, demo script
```

## Conventions

- Every LLM output is validated with a zod schema. On parse failure retry once with the error in the prompt, then fail the stage loudly. Never silently accept malformed output.
- Stages A, C (filtering), and E (hard gates) are deterministic. Stage B, stage D, and the judge inside stage E are the only LLM calls.
- Drafts are structured JSON (sections, assertions, each assertion carries `chart_line_ids` and `clause_ids`). The letter text is rendered deterministically from that JSON. Never ask the model for a free-text letter.
- Chart lines have two identifiers. The **citation label** (`L47`) is what the model sees, cites, and what the renderer prints; line numbers run continuously across a case's documents, so a label is unique within a case. The **database key** (`ACC-DEMO-03-L47`) is the `chart_lines.id` primary key, unique across all cases. Never show a database key to a model. Convert with the helpers in `src/lib/citations.ts`, which is the only place the mapping lives. Clause IDs (`C12`) need no mapping; they are already global.
- Money is compared in integer cents, never floats. Amounts come from Postgres as numeric strings; parse with `toCents` and compare against thresholds in cents so a case cannot land on the wrong side of a boundary through floating point. Dollars are for display only.
- Scripts define a `main()` and call it; no top-level `await`. `tsx` compiles to CommonJS here, where top-level `await` is a syntax error.
- Every pipeline run is persisted: stage inputs, outputs, latency, token counts, cost. The UI reads only from persisted runs. "Run live" creates a new run; "cached" shows the latest completed run.
- The client name never appears in code, seed data, prompts, tests, or docs. Use "the RCM operator" or "the client." The client logo is loaded from `NEXT_PUBLIC_CLIENT_LOGO_URL` with a generic wordmark fallback.
- Criteria sets are synthetic and labeled "InterQual-style" and "MCG-style." Do not reproduce any real proprietary criteria text.
- Secrets live only in `.env.local` and Railway variables. Never read, print, or commit env files.
- UI copy is plain and specific. No marketing tone. No em dashes. Anything mocked is labeled mock on screen.
- Model IDs, prices, and embedding config only in `src/lib/models.ts`. Triage constants only in `src/lib/economics.ts`.

## Working rules

- Unit tests are required for: triage rules, citation validation, routing logic, the letter renderer. Run `npm test` before every commit.
- After any prompt, model, or threshold change, run `npm run eval` and report metric deltas against the previous EvalRun in the commit message.
- Never tune prompts against the test split or the four demo cases. Use the dev split only. The split is fixed at seed time.
- Ask before changing the database schema, the routing thresholds, or anything in `economics.ts`.
- Commit small with descriptive messages. Push to `main` only when build, typecheck, lint, and test are green.
- The host is Windows 11 with PowerShell 7. Do not use bash-only syntax in scripts or `package.json`. Prefer Node scripts over shell scripts.
- When a milestone in `docs/PRD.md` is complete, summarize what was built, what was skipped, and any deviations from the PRD before starting the next one.
