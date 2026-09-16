/**
 * Single source of truth for model IDs, embedding config, and prices.
 *
 * Nothing else in the codebase may hardcode a model ID or a per-token price.
 * Per PRD section 10, each pipeline model is overridable by environment
 * variable so evals can run on a cheaper drafter during iteration.
 */

/** Models used by the three LLM stages. Stage A and stage C make no LLM calls. */
export const MODELS = {
  classify: process.env.MODEL_CLASSIFY ?? "claude-sonnet-5",
  draft: process.env.MODEL_DRAFT ?? "claude-opus-5",
  verify: process.env.MODEL_VERIFY ?? "claude-sonnet-5",
} as const;

export type ModelRole = keyof typeof MODELS;

/**
 * Model for synthetic data generation (seed passes C and D). One-time cost,
 * so it uses the most capable Opus-tier model for realistic charts and letters.
 */
export const SEED_MODEL = process.env.MODEL_SEED ?? "claude-opus-5";

/**
 * Models that accept the server-side `fallbacks: "default"` parameter. When a
 * safety classifier declines a request on one of these, the API re-runs it on
 * a fallback model inside the same call instead of returning a refusal.
 */
export const SERVER_FALLBACK_MODELS: ReadonlySet<string> = new Set(["claude-opus-5"]);
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Models that still accept sampling parameters.
 *
 * Sampling was removed on the Claude 5 generation. Sending `temperature` to
 * claude-sonnet-5 or claude-opus-5 returns:
 *
 *   400 invalid_request_error: `temperature` is deprecated for this model.
 *
 * Verified against the live API on 2026-09-16. So LLM_TEMPERATURE only reaches
 * a request when the configured model is one of these; on the Claude 5 models
 * the knob is inert, and the parameter is never sent.
 */
export const SAMPLING_MODELS: ReadonlySet<string> = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);

/**
 * Temperature for a model, or undefined when that model does not accept one.
 *
 * Defaults to 0: the same input should produce the same route as often as the
 * API allows, which matters more for a live demo than sampling variety.
 * Override with LLM_TEMPERATURE.
 */
export function temperatureFor(model: string): number | undefined {
  if (!SAMPLING_MODELS.has(model)) return undefined;
  const raw = process.env.LLM_TEMPERATURE;
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`LLM_TEMPERATURE must be a number from 0 to 1; got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Identifies which models produced a run, for persistence on PipelineRun and
 * EvalRun. Two runs with different model sets are not comparable.
 */
export function modelSet(): string {
  return `classify=${MODELS.classify},draft=${MODELS.draft},verify=${MODELS.verify}`;
}

export const EMBEDDING_MODEL = "voyage-3.5";
export const EMBEDDING_DIM = 1024;

/**
 * USD per million tokens. Updated by hand from the Anthropic and Voyage
 * pricing pages. Stamp the date whenever these change.
 */
export const PRICES_UPDATED = "2026-09-16";

export interface TokenPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export const PRICES: Record<string, TokenPrice> = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  // Priced because the server-side fallback can serve an Opus 5 request from it.
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/** USD per million tokens embedded. Voyage bills input tokens only. */
export const EMBEDDING_PRICE_PER_MTOK = 0.06;

/**
 * Cost in USD for one LLM call. Throws on an unpriced model rather than
 * silently reporting $0, which would corrupt the cost-per-case metric.
 */
export function costOf(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICES[model];
  if (!price) {
    throw new Error(
      `No price entry for model "${model}". Add it to PRICES in src/lib/models.ts ` +
        `(prices last updated ${PRICES_UPDATED}).`,
    );
  }
  return (tokensIn / 1_000_000) * price.input + (tokensOut / 1_000_000) * price.output;
}

/** Cost in USD for embedding a number of tokens with the configured model. */
export function embeddingCostOf(tokens: number): number {
  return (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MTOK;
}

if (process.argv[1]?.endsWith("models.ts")) {
  console.log("MODELS:", MODELS);
  console.log("modelSet():", modelSet());
  console.log("embedding:", EMBEDDING_MODEL, EMBEDDING_DIM, "dims");
  console.log("prices updated:", PRICES_UPDATED);
  console.log("cost of 10k in / 2k out on draft:", costOf(MODELS.draft, 10_000, 2_000).toFixed(4));
}
