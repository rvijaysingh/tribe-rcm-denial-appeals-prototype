# PRD: Clinical Denial Appeals Copilot (Prototype)

Status: v1, September 2026. Owner: Vijay. Companion to `CLAUDE.md`.

## 1. What this is and who it is for

A working prototype that demonstrates Phase 1 of a proposed engagement: an AI appeal pipeline embedded in an RCM operator's denial workqueue. It exists to be shown in a 15 to 20 minute case presentation to a panel playing the client's business and technical decision-makers. It must prove two things:

1. The to-be workflow on the pitch deck works: a denial arrives, the pipeline drafts a cited appeal in minutes, a nurse reviews it in one panel.
2. The presenter can build and reason about LLM systems at a principal level: structured outputs, deterministic gates, evals, cost and latency, honest limits.

It is not a product. It runs on roughly 40 synthetic cases. Everything mocked is labeled mock.

## 2. Problem context (anonymized for the repo)

The client is a large RCM operator managing tens of billions in net patient revenue for 200+ hospitals. Paid a fixed percentage of collections plus annual tiered incentives.

Today, a clinical denial (medical necessity or level of care on an inpatient claim) is worked like this: it posts to a worklist, an ops rep triages it against a dollar threshold and deadline, a nurse reads a multi-hundred-page chart against payer criteria and unpublished payer rules, drafts a letter over hours, escalates to a physician advisor if needed, and submits. Cycle: days to draft, 45 to 60 days per payer round, three rounds on average.

Where the value leaks (from the outside-in diagnostic):

| Leak | Mechanism | Metric that moves |
|---|---|---|
| Denials never worked | Dollar threshold sits well above breakeven because nurse hours are the binding constraint, not economics | Share of denials worked |
| Cost per appeal | $700 to $1,000 of RN, ops, and physician labor per fully worked appeal | Cost per appeal |
| Low overturn rate | ~42% clinical overturn; inconsistent letters; ~30% of denials cite payer rules that live only in nurse memory | Overturn rate |
| Slow submission | Days from denial to appeal; windows are 90 to 180 days | Days to submission |
| Clinician drag | Physician attestations and peer-to-peer calls on cases the letter should have won | Physician escalations |

Phase 1 targets the first four. Deck targets: cost per appeal $700 to 1,000 down to $200 to 350; overturn 42% to 46 to 48%; submission ~40% faster.

## 3. Users

| User | Role in prototype | What they see |
|---|---|---|
| Clinical appeals nurse (primary) | Reviews drafts | Workqueue, account detail, review panel |
| Denials manager | Watches throughput and quality | Metrics dashboard |
| Technical reviewer (panel) | Judges the build | Run log, eval dashboard, repo |

The presenter plays the nurse during the demo.

## 4. Goals, non-goals, success criteria

**Goals**

- Run the full five-stage pipeline on a case live, with staged UI rendering and a streaming draft, in under 90 seconds.
- Show four demo cases covering the four routes.
- Show a review panel where every clinical assertion in the draft is linked to a chart line and a criteria clause.
- Capture reviewer approve / edit / escalate as feedback.
- Show real eval results from a 20-case test split and real cost per case.
- Be resettable in one click for repeated rehearsals.

**Non-goals (stated on screen)**

- No auto-submit. No fine-tuning. No replacement of the worklist system. No payer-facing automation. No real EHR integration. No PHI.

**Prototype success criteria**

- All four demo cases run end to end with the expected route.
- Citation validity 100% on demo cases (every cited line and clause exists).
- Eval harness runs on 20 cases and reports every metric in section 9.
- Live run of demo case 1 completes in under 90 seconds on Railway.
- `npm run demo:reset` returns any demo case to unprocessed in under 2 seconds.

## 5. Scope

**In**

- Denial family: inpatient clinical denials, two categories: medical necessity (admission not justified) and level of care (inpatient vs observation).
- 3 payers, 4 clinical conditions (CHF exacerbation, sepsis, COPD exacerbation, community-acquired pneumonia).
- Stages A to E, orchestrator, persistence, run log.
- Workqueue, account detail, review panel, metrics dashboard, eval dashboard.
- Synthetic data generation, eval harness, demo controls.

**Out**

- Phase 2 (prevention) screen. Cut.
- Level 2 appeals, physician advisor workflow beyond an "escalated" state.
- Authentication. Public URL, protected only by a live-run rate cap.
- Any denial type other than the two above.

## 6. User journey and screens

### 6.1 Workqueue (mock)

Table of denied accounts. Columns: account, payer, condition, denial category, amount, days left in window, triage decision, expected value, pipeline status, route, cost. Labeled "Mock workqueue" in the header. Client logo top left (from env, fallback generic wordmark).

Rows already triaged "do not appeal" show a muted badge, $0 cost, 0 reviewer minutes. At least three such rows in the seed: one expired window, one below economic threshold, one ineligible.

Filters: route, payer. Sort: expected value descending by default.

### 6.2 Account detail

Left: the messy inputs, exactly as received. Denial letter text with the 835 CARC/RARC codes. Chart excerpts as line-numbered documents (H&P, progress notes, discharge summary). Criteria set name and payer notes summary.

Right: pipeline progress. Five stage cards A to E. Each card shows status (pending, running, done, skipped), elapsed time, and a one-line result when done. Stage A shows the triage decision and expected value math. Stage B shows category, root cause, confidence. Stage C shows retrieved clauses and precedents with similarity scores. Stage D streams the draft. Stage E shows citation check, coverage, judge score, and the route.

Controls: **Run live** (creates a new run, streams), **Show cached** (latest completed run), **Reset case** (visible only when `NEXT_PUBLIC_DEMO_CONTROLS=true`).

### 6.3 Review panel

Opens from account detail once a run completes. Three tabs.

- **Draft**: the rendered letter. Each assertion is a citation chip. Hover or click a chip to highlight the chart line and the clause it cites.
- **Evidence**: the criteria matrix. One row per required clause: clause text, status (supported / weak / unsupported), supporting chart lines, confidence.
- **Run log**: stage-by-stage inputs, outputs, latency, tokens, cost.

Header: route badge with its definition on hover ("Ready: quick read and approve. Needs review: close read. Needs docs: a required criterion has no chart support. Do not appeal: triage stopped it."). Confidence. Payer-history flag if the precedent store shows this payer overturns this category below 40%.

Actions: **Approve**, **Edit** (opens the letter in a textarea; on save, store the diff), **Escalate to physician** (requires a reason from a short list). All three write a ReviewerFeedback row and stamp reviewer minutes from panel-open to action.

### 6.4 Metrics dashboard

Two panels, clearly separated.

**Measured in this prototype** (live from the DB): cases processed, route distribution, pipeline seconds per case (median, p90), cost per case (median), citation validity rate, reviewer minutes per case (from feedback rows), reviewer agreement rate (approved as-is / all reviewed), share of denials worked under prototype triage vs old capacity cutoff.

**Production targets (from the proposal, not measured here)**: cost per appeal, overturn rate, days to submission, physician escalations, each with baseline and Phase 1 target. Footnote: validated in discovery.

Note under cost per case: "Synthetic charts are 2 to 4 pages. Production charts run to hundreds of pages; the proposal assumes $2 to 5 per appeal."

### 6.5 Eval dashboard

Latest EvalRun with every metric in section 9, plus a small history table of prior runs (prompt version, model, metrics). The reference run (see 9.3) is badged as such. Banner: "n=20 synthetic test cases. Metrics stabilize with the ~200 labeled appeals per payer specified for Phase 1."

## 7. Pipeline specification

Fixed sequence, no autonomous tool use, every run logged. Orchestrator runs A, then B, C, D, E. If A returns do-not-appeal the run ends there with zero LLM cost.

### Stage A: Triage (deterministic)

Inputs: denial (amount, category, received date, payer deadline days, eligibility flags), payer, `economics.ts`.

Logic:
- Eligible if the payer allows appeal on this category and the account is not flagged non-appealable.
- Days left = deadline days minus days since received. Expired if ≤ 0.
- P(overturn) = lookup in `WIN_RATE[payer][category]` (seeded from the synthetic precedent store, values between 0.35 and 0.75).
- Expected value = amount × P(overturn).
- Appeal if eligible, not expired, and EV > `COST_PER_APPEAL_AI` (default 275).
- Also compute `would_have_been_worked_old` = EV > `COST_PER_APPEAL_MANUAL` (735) AND amount ≥ `OLD_CAPACITY_CUTOFF` (5000). Stored for the threshold story.

Output: `{ decision: "appeal" | "do_not_appeal", reason, days_left, p_overturn, expected_value, would_have_been_worked_old }`.

Tests: every branch. Expired, ineligible, below EV, boundary at exactly the threshold.

### Stage B: Classify (LLM, `MODELS.classify`)

Inputs: denial letter text, CARC/RARC codes, condition, chart excerpt headers (not full text).

Prompt: classify into category (medical_necessity | level_of_care), identify the root cause the payer is asserting as one of a fixed enum per category (e.g. `severity_not_documented`, `treatment_appropriate_at_lower_level`, `los_exceeds_expected`, `criteria_not_met_at_admission`), extract 3 to 6 key facts the payer relies on, and return a confidence in [0,1].

Output schema (zod): `{ category, root_cause, key_facts: string[], confidence }`. Enum-validated.

### Stage C: Retrieve (deterministic filter, then vector)

Inputs: payer, condition, category, root_cause, chart text.

Logic:
1. Metadata filter: criteria clauses where `payer_id = payer AND condition = condition`. Precedents where `payer_id = payer AND category = category AND outcome = 'overturned'`.
2. Embed a query built from root_cause plus key_facts with Voyage. Cosine search within the filtered sets. Return top 8 clauses and top 3 precedents with scores.
3. Always include clauses marked `required = true` for that payer and condition even if they rank low. Mark them.

Output: `{ clauses: [{ id, text, required, score }], precedents: [{ id, summary, score, outcome }] }`.

Note for the interview: at 40 records a filter alone would work. The vector step shows the production shape.

### Stage D: Draft (LLM, `MODELS.draft`)

Inputs: full chart with line IDs, retrieved clauses with IDs, precedent summaries, denial key facts, payer letter template (fixed sections).

Prompt: produce a structured draft. Every assertion must cite at least one chart line ID and at least one clause ID. Do not assert anything not supported by a cited line. If a required clause cannot be supported, emit it in `unsupported_required` with what evidence would be needed. Stream the output.

Weak versus absent, the bright line: unsupported means the chart contains no evidence at all for that clause. A count, dose, duration or frequency that the chart records but that falls short is thin support: argue it and lower `draft_confidence`. Concede only when the chart never records that kind of evidence at all.

Output schema:

```
{
  sections: [{
    name: "intro" | "clinical_summary" | "criteria_argument" | "precedent" | "request",
    assertions: [{
      text: string,
      chart_line_ids: string[],   // min 1 except intro and request
      clause_ids: string[]        // min 1 in criteria_argument
    }]
  }],
  unsupported_required: [{ clause_id, evidence_needed: string }],
  draft_confidence: number
}
```

Renderer (`src/lib/render`) turns this into letter text with inline citation markers `[C12]` and `[L47]`. The renderer is pure and tested.

### Stage E: Verify and route (deterministic gates, then LLM judge, `MODELS.verify`)

Deterministic gates, in order:
1. Citation validity: every `chart_line_ids` entry exists in this case's chart; every `clause_ids` entry exists in the retrieved set. Any failure → validity < 100% → cannot be "ready."
2. Coverage: share of required clauses that have at least one assertion citing them. Store.
3. If `unsupported_required` is non-empty → route **needs docs**, list the evidence needed, skip the judge.

LLM judge (only if gates pass): given the rendered letter, the chart, the clauses and the precedent summaries, score 0 to 1 on: faithfulness (do cited lines actually support the assertions), completeness (are the required criteria argued), tone and template compliance. Return per-dimension scores, an overall score, and up to 3 flagged assertions with reasons.

Routing:
- Composite = min(classify.confidence, draft_confidence, judge.overall).
- **ready** if composite ≥ 0.85 and validity = 100% and no flagged assertions.
- **needs review** if 0.60 ≤ composite < 0.85, or any flagged assertion, or validity < 100%. A composite below 0.60 also routes needs review, with the reason saying the confidence is under the review threshold. There is no lower band that routes anywhere else: nothing but stage A writes a case off.
- **needs docs** from the gate above.
- **do not appeal** from stage A only.

Output: `{ validity_rate, coverage, judge: {...}, route, route_reason }`.

Tests: routing table, validity checker, coverage math.

### Orchestrator

- Persists a PipelineRun row at start, a StageOutput row per stage, and updates status on completion or failure.
- Records latency, input and output tokens, and cost per stage using the price table in `models.ts`.
- Streams stage events over SSE to the UI: `stage_started`, `stage_completed`, `draft_token`, `run_completed`, `run_failed`.
- Uses Anthropic prompt caching for the system prompt and the criteria block.
- Rate cap: max 20 live runs per rolling hour, enforced server-side, returns 429 with a friendly message.

## 8. Data specification

### 8.1 Entities

| Entity | Key fields |
|---|---|
| Payer | id, name (synthetic: Pinnacle Health Plan, Cascade Mutual, Northgate Advantage), criteria_style (interqual_style / mcg_style), deadline_days, appeal_format_notes |
| CriteriaSet | id, payer_id, condition, version |
| CriteriaClause | id, set_id, code (e.g. CHF-03), text, required (bool), embedding vector(1024) |
| PayerNote | id, payer_id, condition, text (the "unpublished rule" the nurses know), embedding |
| Account | id, mrn (synthetic), patient_age, admit_date, discharge_date, drg, condition |
| Denial | id, account_id, payer_id, category, amount, received_date, carc, rarc, letter_text, eligible (bool), split (dev / test / demo) |
| ChartDoc | id, account_id, doc_type (hp / progress / discharge), text |
| ChartLine | id (e.g. L47), doc_id, line_no, text |
| PrecedentAppeal | id, payer_id, category, condition, summary, outcome (overturned / upheld), letter_excerpt, embedding |
| GroundTruth | denial_id, category, root_cause, met_clause_ids, unmet_required_clause_ids, expected_route, winnable (bool), approve_as_is (bool) |
| PipelineRun | id, denial_id, status, started_at, completed_at, total_ms, total_cost, prompt_version, model_set |
| StageOutput | id, run_id, stage, input_json, output_json, ms, tokens_in, tokens_out, cost |
| ReviewerFeedback | id, run_id, action (approve / edit / escalate), edited_text, diff_json, reason, reviewer_minutes |
| EvalRun | id, created_at, prompt_version, model_set, metrics_json, per_case_json, reference (bool) |

pgvector columns are `vector(1024)`. Use HNSW indexes.

### 8.2 Synthetic data generation (scripts/seed)

Five passes. The point of the pass structure is to avoid leakage: chart text is generated without seeing the criteria text, so the model cannot copy criteria language into the chart.

- **Pass A: Criteria.** For each payer × condition, generate 6 to 9 clauses in the payer's style, 3 to 4 marked required, plus 1 to 2 PayerNotes (unpublished rules, e.g. "requires documented failure of diuretics prior to admission"). Deterministic seed so reruns are stable.
- **Pass B: Case seeds.** For each of 40 cases, a structured seed: payer, condition, category, amount, days-since-received, which required clauses are met / weakly met / unmet, severity markers present. Generated by script, not LLM.
- **Pass C: Charts.** From the case seed only, generate H&P, two progress notes, and a discharge summary with realistic clinical detail and line numbers. The prompt receives the clinical facts to include or omit, never the clause text.
- **Pass D: Denial letters and precedents.** From the seed plus clause codes, generate the payer's denial letter with CARC/RARC codes. Separately generate 4 to 6 precedent appeals per payer × category with outcomes.
- **Pass E: Ground truth.** Derived from the seed: category, root cause, met and unmet clauses, expected route (all required met and strong → ready; some weak → needs review; any required unmet → needs docs; triage fail → do not appeal), winnable, approve_as_is. Human spot-check on 8 cases, corrections recorded.

Split: 16 dev, 20 test, 4 demo, over the 40 cases from Pass B. Fixed at seed time. Demo cases are excluded from every eval and from prompt tuning. n=20 on test gives 5-point granularity on every percentage metric; n=12 would give 8-point granularity, which reads as noise on a dashboard. 16 dev cases is enough for prompt tuning.

The three pre-triaged do-not-appeal rows in 8.3 are additional to the 40, for 43 denials total. All three are tagged `split = 'demo'` so they never enter an eval. Generate short charts for them anyway so the account detail page works if someone clicks one.

Embeddings are computed at seed time with Voyage and stored.

### 8.3 The four demo cases

| # | Payer | Condition | Amount | Setup | Expected route | What it demonstrates |
|---|---|---|---|---|---|---|
| DEMO-01 | Pinnacle (InterQual-style) | CHF exacerbation | $18,500 | All required clauses strongly supported, 41 days left | ready | Clean end-to-end run, live with streaming |
| DEMO-02 | Cascade (MCG-style) | COPD exacerbation | $2,400 | Supported, 60 days left. Under the old $5K capacity cutoff this was never worked | ready | Threshold story: `would_have_been_worked_old = false` shown on the card |
| DEMO-03 | Northgate | Sepsis | $22,000 | Chart lacks the lactate value and repeat vitals the payer's required clause needs | needs docs | Exact missing element named; RN can request records instead of arguing |
| DEMO-04 | Pinnacle | Pneumonia | $9,800 | Supported but one assertion rests on a weak inference; judge flags it | needs review | RN edits the flagged sentence, diff is stored, agreement metric updates |

DEMO-02 was briefly relabelled `needs_review` during M2, while the drafter was misattributing what the retrieved precedent had been decided on and the judge was correctly flagging it. That turned out to be a defect in the drafter rather than a property of the case: once the precedent citation rule was tightened, DEMO-02 ran clean at judge 0.92 with nothing flagged. The label is `ready`, and `spot-checks.json` records the review that confirmed it. The episode is worth keeping in mind when a demo case and a metric disagree: relabelling the case is sometimes right, but check the pipeline first.

Plus three pre-triaged do-not-appeal rows in the queue, additional to the 40 and tagged `split = 'demo'`: expired window (day 184 of 180), EV below threshold ($700 at P(overturn) at or below the payer floor; at Northgate medical_necessity, P=0.38, EV = $266, under the $275 `COST_PER_APPEAL_AI`), ineligible category for that payer. Each gets a short chart so the account detail page renders.

## 9. Evaluation

### 9.1 Harness

`npm run eval` runs the pipeline on the 20 test cases (and optionally the 16 dev cases with `--split dev`), compares to GroundTruth, writes an EvalRun with aggregate metrics and per-case detail. Records prompt version and model set. Never touches demo cases.

### 9.2 Metrics

| Stage | Metric | Definition |
|---|---|---|
| A | False write-off rate | Do-not-appeal decisions on cases labeled winnable / all winnable |
| A | Rule tests | Unit test pass rate, expected 100% |
| B | Category accuracy | Exact match vs label |
| B | Root-cause accuracy | Exact match vs label |
| B | Confidence calibration | Mean confidence on correct vs incorrect classifications |
| C | Clause recall@8 | Share of labeled met_clause_ids present in retrieved set |
| C | Precedent recall@3 | At least one overturned precedent of the same category retrieved |
| D | Citation validity | Cited IDs that exist / all cited IDs. Deterministic |
| D | Criteria coverage | Required clauses with ≥1 citing assertion / required clauses |
| D | Faithfulness | Judge-scored: assertions whose cited lines support them / all assertions |
| E | Route accuracy | Route match vs expected_route |
| E | Judge agreement | Judge overall ≥ 0.85 matches human approve_as_is label |
| E2E | Pipeline seconds | Median and p90 |
| E2E | Cost per case | Median, from token counts × price table |
| E2E | Reviewer agreement | Approve-as-is / all reviewed (from ReviewerFeedback, demo and rehearsal runs) |

### 9.3 Rules

- Never tune on the test split or demo cases.
- Every prompt change gets an EvalRun before merge. Report deltas.
- The judge uses a different model than the drafter and sees the source material, not just the letter.
- Metrics at n=20 test cases are noisy. The dashboard says so.
- Eval cost. During M2 to M4 iteration, run evals with `MODEL_DRAFT=claude-sonnet-5` to keep spend down. Before the demo, run one final eval on Opus and set `reference = true` on that EvalRun. The eval dashboard badges the reference run. Only the reference run is quoted as the prototype's result; iteration runs are for deltas.

## 10. Architecture and hosting

- Single Next.js app. API routes call the pipeline. Scripts share `src/lib`.
- Railway: app service plus Postgres service in one project, private networking. App uses `${{Postgres.DATABASE_URL}}`. Local dev uses the public proxy URL.
- `src/lib/models.ts`:

```
MODELS = { classify: "claude-sonnet-5", draft: "claude-opus-5", verify: "claude-sonnet-5" }
// each overridable by MODEL_CLASSIFY, MODEL_DRAFT, MODEL_VERIFY
EMBEDDING_MODEL = "voyage-3.5"; EMBEDDING_DIM = 1024
PRICES = { per-million input/output per model, updated by hand, date-stamped }
```

- `src/lib/economics.ts`: `COST_PER_APPEAL_MANUAL = 735`, `COST_PER_APPEAL_AI = 275`, `OLD_CAPACITY_CUTOFF = 5000`, `WIN_RATE` table, routing thresholds `READY = 0.85`, `REVIEW = 0.60`.
- Prompt caching on system prompt and criteria block.
- All runs persisted; UI reads from DB. SSE for live runs.
- Env: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_CLIENT_LOGO_URL` (optional), `NEXT_PUBLIC_DEMO_CONTROLS` (default false in prod, true in dev).

Production deltas, stated in the README and the interview: runs in the client's cloud tenancy with BAA; chart feed via FHIR/HL7; embedded in the real worklist via its extension API with draft write-back; ~200 labeled appeals per payer for evals; PHI controls, RBAC, audit log per draft.

## 11. Demo plan

**Setup before the session**: `npm run db:seed`, run all four demo cases once so cached runs exist, then `npm run demo:reset -- --case DEMO-01` so case 1 is fresh for the live run. Confirm public URL loads. Have the three-minute screen recording ready as fallback.

**Script (about 6 minutes)**

1. Workqueue. Point at the three do-not-appeal rows: zero cost, zero nurse minutes. Point at DEMO-02's amount and "not worked under old cutoff" flag.
2. Open DEMO-01. Show the messy inputs. Click Run live. Narrate stages as they land: triage math in 1 second, classification with confidence, retrieved clauses with the required ones marked, draft streaming, verify gates, route.
3. Review panel. Click two citation chips. Show the evidence matrix. Approve.
4. Open DEMO-03 (cached). Needs docs. Show the named missing element.
5. Open DEMO-04 (cached). Needs review. Show the flagged assertion, edit it, save. Show the feedback row.
6. Open DEMO-02 (cached). A $2,400 denial the old capacity cutoff never let anyone work, now in the queue with a clean cited draft and a ready route. The line to say: nobody would have touched this case last year, and it took minutes and cents to produce something a nurse can approve on a quick read.
7. Metrics dashboard, measured panel. Then eval dashboard. Say the n=20 caveat before anyone asks.
8. Return to the deck with one line: what was mock, what Phase 1 uses.

**Fallback**: if the live run fails, click Show cached and continue. If the site is down, play the recording.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Live Opus draft exceeds 90 seconds | Prompt caching, chart excerpts kept to 2 to 4 pages, stream tokens, run one case live only |
| API outage during demo | Cached toggle, recording |
| Judge disagrees with human labels | Report it honestly on the eval dashboard; it is the point of measuring |
| Synthetic charts leak criteria language | Pass structure in 8.2; spot-check 8 cases |
| Panelist compares $0.50 cost to the $2 to 5 on the slide | On-screen note explaining chart size |
| Credits drained via public URL | 20 live runs per hour cap; keep balance modest |
| Claude 5 models do not support `temperature` | Route stability relies on prompt precision and deterministic gates, not on a sampling setting. `LLM_TEMPERATURE` is wired but inert unless a 4.6-family model is pinned |

## 13. Build milestones (in order)

**M1: Schema and seed.** Drizzle schema for all entities, migrations, `db:seed` with passes A to E, embeddings stored, split assigned, `demo:reset`. Exit: seed runs clean twice in a row; 40 denials, 4 demo, ground truth for all.

**M2: Pipeline.** Stages A to E, orchestrator, persistence, `npm run pipeline -- --case`. Unit tests for A, renderer, E gates and routing. Exit: all four demo cases produce the expected route from the CLI.

**M3: UI.** Workqueue, account detail with SSE streaming, review panel with citation chips and evidence matrix, feedback actions, demo controls, logo from env, plus the metrics dashboard with the two-panel split and the eval dashboard. Both dashboard screens moved here from M4 and read from the DB; the eval screen shows an empty state until the harness writes its first run. Exit: full demo script runs on localhost and on Railway.

**M4: Evals.** Harness, metric functions, EvalRun persistence, `npm run eval`, and marking the reference run. The dashboards that render the output were built in M3. Exit: `npm run eval` produces every metric in 9.2; dashboards render from DB.

**M5: Demo hardening.** Rate cap, on-screen notes, README with production deltas and mock disclosure, screen recording, three full rehearsals with reset between each. Exit: presenter can run the script cold in under 7 minutes.

## 14. Open questions

- Payer letter template sections: fixed at the five in 7D unless a better structure emerges in M2.
- Whether to add Voyage's healthcare-tuned embedding model as a config option for the talking point. Low priority.
- Whether reviewer minutes should be shown per case in the review panel header. Probably yes if cheap.
