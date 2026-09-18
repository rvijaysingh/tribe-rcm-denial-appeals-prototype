# Clinical Appeals Engine

A working prototype of a GenAI engine for clinical denial appeals in healthcare revenue cycle management. A mock billing workqueue runs a five-stage pipeline over each denied account, drafts a fully cited appeal letter, and routes it to a nurse reviewer who approves, edits, or escalates.

**Nothing auto-submits.** Every letter ends at a human.

Built as a case-presentation prototype. It is a demonstration of an approach, not a product.

---

## Read this first: what is real and what is mock

The distinction matters more than anything else in this repo, so it is stated here and labeled again on every screen.

### Real

These are genuinely running, not simulated.

- **The pipeline.** Five stages, three of them live LLM calls to the Anthropic API, one a live vector search over pgvector. Stage latencies, token counts and costs on screen are measured, not scripted.
- **Citation checking.** Every chart line and criteria clause the model cites is checked against the case's actual chart and the actual retrieved clause set. The validity rate is arithmetic, not an opinion.
- **Retrieval.** Real embeddings (Voyage `voyage-3.5`, 1024 dimensions) with HNSW cosine indexes in Postgres. Similarity scores on screen are the real distances.
- **The eval harness.** `npm run eval` runs the pipeline over a held-out labeled split and computes every metric from scratch. The eval dashboard reads those rows.
- **Persistence.** Every run writes its stage inputs, outputs, latency, tokens and cost. The UI reads from the database, never from memory.

### Mock

- **All data is synthetic.** Every patient, chart, denial letter, payer and precedent was generated for this prototype. **No PHI, and no real patient ever existed.** Payer names (Pinnacle Health Plan, Cascade, Northgate Advantage) are invented.
- **The criteria sets are synthetic.** They are labeled "InterQual-style" and "MCG-style" because they imitate the *shape* of such criteria. No proprietary criteria text is reproduced anywhere in this repo.
- **The workqueue is mock.** A real deployment reads the client's worklist; this reads a seeded table.
- **The Phase 1 levers table** on the Claim Denial Dashboard is from the proposal. Those figures are not measured by this prototype and the panel says so on screen. So is the recovery-rate chart, and the history behind the RN touch-time chart.
- **Reviewer actions are a single-user simulation.** There is no auth, no real nurse, no RBAC.
- **The client is never named.** The header reads "The RCM operator" unless `NEXT_PUBLIC_CLIENT_LOGO_URL` is set.

Anything mocked carries a `MOCK` badge in the interface.

---

## The pipeline

Fixed sequence. No autonomous tool use. Every run logged.

| Stage | What it does | How |
|---|---|---|
| **A** Triage | Appeal or do not appeal, from amount, win rate, deadline and eligibility | Deterministic rules, integer cents |
| **B** Classify | Denial category, root cause, key facts, confidence | LLM, structured output |
| **C** Retrieve | Payer criteria clauses and overturned precedents | Vector search, required clauses forced in |
| **D** Draft | Structured draft where every assertion cites chart lines and clauses | LLM, structured output, streamed |
| **E** Verify | Citation validity, criteria coverage, LLM judge, route | Deterministic gates first, then judge |

Stage A stops a do-not-appeal case before any LLM call, so a written-off case costs nothing.

The letter text is rendered deterministically from the draft JSON. The model is never asked for free-form prose. That is what makes every sentence traceable to a citation.

Routes: `ready`, `needs review`, `needs docs`, `do not appeal`.

---

## Measured results

From the reference eval run on 20 held-out synthetic test cases. Reproduce with `npm run eval`.

| Stage | Metric | Result |
|---|---|---|
| A | False write-off rate | **0.0%** (0 of 13 workable cases) |
| A | Rule test pass rate | **100%** (479 of 479) |
| B | Category accuracy | **94.1%** (16 of 17) |
| B | Root-cause accuracy | **88.2%** (15 of 17) |
| B | Confidence calibration | 0.88 mean on correct, 0.92 on the single incorrect |
| C | Clause recall@8 | **0.98** over 17 cases |
| C | Precedent recall@3 | **94.1%** (16 of 17) |
| D | Citation validity | **100%** (860 of 860 cited IDs) |
| D | Criteria coverage | **91.5%** (54 of 59 required clauses argued) |
| D | Faithfulness (judge) | **98.8%** (488 of 494 assertions unflagged) |
| E | Route accuracy | **75.0%** (15 of 20) |
| E | Judge agreement | **58.3%** (7 of 12) |
| E2E | Pipeline seconds | **69.0s** median, 101.5s p90 |
| E2E | Cost per case | **$0.18** median, $0.22 p90 |
| E2E | Cases completed | **20 of 20**, 0 errors |

Reference run `er-0003`: classify and verify on `claude-sonnet-5`, draft on `claude-opus-5`.

**Citation validity is the number this design exists to produce.** 860 cited chart lines and criteria clauses across twenty letters, every one of them resolving to something that actually exists in that case's chart or retrieved clause set. Zero fabricated citations.

**Route accuracy of 75% deserves its detail**, because the five misses are not equivalent.

Four of them route *more* cautiously than the label: three cases labeled `ready` came out `needs review` or `needs docs`, and one labeled `needs review` came out `needs docs`. For a system where a human reads every letter before it goes anywhere, those cost reviewer minutes rather than credibility.

The fifth goes the other way. One case labeled `needs docs` routed `needs review`, meaning the pipeline believed the chart supported a required criterion that the label says has no support. That is the direction that matters: it puts a letter in front of a reviewer as arguable when the honest answer is that records are missing. The reviewer still catches it, which is the point of the design, but it is the one miss worth fixing rather than absorbing.

Nothing was marked `ready` that should not have been, and nothing winnable was written off.

**Judge agreement of 58.3% is the weakest metric here and is reported rather than buried.** n=12, so one case moves it eight points. It measures whether the judge's overall score crossing 0.85 predicts the human `approve_as_is` label, and at this sample size it mostly measures noise.

**Read these with the denominator in view.** n=20 is a small set and these metrics are noisy at that size; a single case moves a rate by five points. The eval dashboard says so above the numbers. The proposal specifies ~200 labeled appeals per payer before these stabilize.

---

## The economics this is built around

Rates and per-appeal figures only; no book-level numbers appear in this repo.

| Figure | Value |
|---|---|
| Loaded cost per manual appeal | ~$735 |
| Cost per AI-assisted appeal | ~$300 |
| Win rate on low-value claims | ~40% |
| **Manual breakeven** | **~$1,800** ($735 / 40%) |
| **AI breakeven** | **~$750** ($300 / 40%) |
| **Work threshold today** | **~$5,000** (2.7x breakeven) |
| **Work threshold with the pipeline** | **~$1,200** (1.6x breakeven) |

The gap between those last two lines is the whole argument. A manually worked appeal breaks even near $1,800, but the minimum-balance threshold sits around $5,000, roughly 2.8x breakeven. RCM shops set it there deliberately, to cover the RN opportunity cost of the next case in the queue and the timely-filing risk carried while it waits. RN hours are the binding constraint, not economics.

So the $1,800 to $5,000 range fills with denials that are economic to appeal and never appealed. About 30% of clinical denials are never appealed at all, averaging ~$3K, all of them under the work threshold. Dropping the cost of an appeal to ~$300 moves breakeven to ~$750 and the work threshold to ~$1,200. The threshold falls further than the breakeven does, because RN minutes replace RN hours so opportunity cost collapses, and same-day filing removes the expiry risk.

On the claims that do get appealed, ~60% are won by count but only ~47% by dollars, because the high-value inpatient claims are fought hardest and lost most often. Across all clinical denied dollars the overturn rate is 42%. Each payer round runs 45 to 60 days, three rounds on average, so a contested claim sits in A/R for four to six months.

DEMO-02 in the workqueue is this case in miniature: a $2,400 denial, comfortably above today's breakeven, below today's work threshold, and therefore never filed.

## Production deltas

What a real deployment changes, stated plainly because the prototype does none of it.

| Area | This prototype | Production |
|---|---|---|
| Hosting | Railway, public URL | The client's cloud tenancy, under BAA |
| Data | Synthetic charts, seeded tables | Chart feed via FHIR/HL7 from the source systems |
| Workqueue | A mock table in this app | Embedded in the real worklist through its extension API, with draft write-back |
| Evals | 20 synthetic cases, labels derived at seed time | ~200 labeled appeals per payer, labeled by clinical staff |
| PHI | None, by construction | PHI controls, RBAC, audit log per draft |
| Identity | No auth, single user | SSO, per-reviewer identity on every feedback row |
| Chart size | 2 to 4 pages | Hundreds of pages, which is why cost per case here is not the production figure |
| Criteria | Synthetic, "InterQual-style" | The client's licensed criteria, under their license |

The chart-size point is the one most likely to be misread. Cost per case here is cents. The proposal assumes $2 to $5 per appeal in production, because production charts are two orders of magnitude longer. The Claim Denial Dashboard carries that note under the figure.

---

## Running it

Requires Node 20+, a Postgres 18 database with pgvector, and API keys.

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run db:push                # create the schema
npm run db:seed                # load synthetic data and embeddings
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `typecheck` / `lint` / `test` | All four must pass before any commit |
| `npm run db:push` | Apply the schema to `DATABASE_URL` |
| `npm run db:seed` | Regenerate and load synthetic data. Idempotent; only calls the API with `--generate` |
| `npm run pipeline -- --case <id>` | Run the pipeline on one case from the CLI |
| `npm run eval` | Run the eval harness on the test split and write an EvalRun |
| `npm run eval -- --reference` | Mark that run as the reference run |
| `npm run demo:reset -- --case <id>` | Delete runs and feedback for a demo case |

### Environment

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | The three LLM stages |
| `VOYAGE_API_KEY` | Embeddings for retrieval |
| `DATABASE_URL` | Postgres with pgvector |
| `NEXT_PUBLIC_CLIENT_LOGO_URL` | Optional. Unset shows a generic wordmark; the client is never named in this repo |
| `NEXT_PUBLIC_DEMO_CONTROLS` | Shows the Reset case control. Keep `false` in production |
| `LIVE_RUN_LIMIT` | Live runs allowed per hour, default 20 |
| `MODEL_CLASSIFY` / `MODEL_DRAFT` / `MODEL_VERIFY` | Override a stage's model |
| `LLM_TEMPERATURE` | Inert on Claude 5 models, which removed sampling. Applies only when a 4.6-family model is pinned |

Secrets live in `.env.local` and Railway variables. They are never committed.

### Rate cap

Live runs from the web UI are capped at 20 per rolling hour per server process, because the demo runs on a public URL with a real API key behind it. A refused run returns a 429 with a plain-language message and the cached run still displays. CLI and eval runs are not counted against the cap.

---

## Layout

```
src/app/(workqueue)/   workqueue, account detail, Appeals Workbench
src/app/dashboard/     metrics and eval dashboards
src/app/api/           pipeline (SSE), feedback, demo reset
src/lib/pipeline/      the five stages and the orchestrator
src/lib/prompts/       prompt templates, versioned in the filename
src/lib/render/        deterministic letter renderer
src/lib/eval/          the metric contract shared by harness and dashboard
src/lib/db/            drizzle schema, client, typed queries
scripts/seed/          synthetic data generation, passes A to E
scripts/eval/          the harness and its metric functions
docs/PRD.md            the full specification
```

### Notes on the design

A few decisions that are load-bearing:

- **Structured drafts, rendered letters.** The model returns sections and assertions with citation IDs; the letter is assembled by pure code. A free-text letter cannot be citation-checked.
- **Two chart line identifiers.** The model sees and cites `L47`. The database key is `ACC-DEMO-03-L47`. One mapping layer, and a model is never shown a key.
- **Integer cents everywhere.** Money is parsed to cents and compared as integers so a case cannot land on the wrong side of a threshold through floating point.
- **Seed data cannot leak criteria wording into charts.** Clause text is written in policy voice and chart facts in clinical voice, and a test proves no 6-word shingle is shared between them. Otherwise retrieval would look better than it is.
- **The pipeline cannot read ground truth.** `loadPipelineCase` does not touch the labels table. Only the eval harness holds both sides.

---

## Licence

MIT. See `LICENSE`.

Synthetic data only. No PHI. The client is not named anywhere in this repository.
