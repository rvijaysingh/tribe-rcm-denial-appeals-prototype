/**
 * Structured LLM generation shared by the seed scripts and the pipeline.
 *
 * Contract (CLAUDE.md conventions):
 * - Output is constrained with a JSON schema and then validated with zod.
 * - An optional deterministic check runs after zod (e.g. leakage or
 *   required-term checks in the seed).
 * - On a parse or check failure, retry once with the error in the prompt,
 *   then throw. Malformed output is never silently accepted.
 * - Refusals and max_tokens truncation throw immediately with context.
 *
 * Set LLM_DEBUG=1 to log every prompt and raw response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SERVER_FALLBACK_BETA, SERVER_FALLBACK_MODELS, costOf } from "./models";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
    }
    client = new Anthropic();
  }
  return client;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GenerateOptions<S extends z.ZodType> {
  /** Short label for logs and error messages, e.g. "chart:CASE-007". */
  label: string;
  model: string;
  system: string;
  prompt: string;
  schema: S;
  maxTokens: number;
  effort?: Effort;
  /**
   * Deterministic, lossless cleanup applied after schema validation and before
   * the check, e.g. dropping blank separator lines. The returned value is what
   * the caller receives.
   */
  normalize?: (data: z.infer<S>) => z.infer<S>;
  /**
   * Deterministic check on the parsed output. Return null when it passes or a
   * message describing the problem, which is fed back to the model on retry.
   */
  check?: (data: z.infer<S>) => string | null;
}

export interface GenerateResult<T> {
  data: T;
  /** The model that actually served the final attempt (may be a fallback). */
  servedModel: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ms: number;
  attempts: number;
}

/** Thrown when generation fails after the retry. Carries the raw text for debugging. */
export class GenerationError extends Error {
  constructor(
    message: string,
    readonly label: string,
    readonly rawText: string | null,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

function debug(label: string, what: string, body: string): void {
  if (process.env.LLM_DEBUG === "1") {
    console.debug(`[llm:${label}] ${what}\n${body}\n`);
  }
}

/** Parse JSON tolerantly: strips markdown fences and text around the outer object. */
export function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("response contains no JSON object");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callOnce<S extends z.ZodType>(
  opts: GenerateOptions<S>,
  prompt: string,
): Promise<{ text: string; servedModel: string; tokensIn: number; tokensOut: number }> {
  const useFallback = SERVER_FALLBACK_MODELS.has(opts.model);
  debug(opts.label, "prompt", prompt);

  const stream = getClient().beta.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
    output_config: {
      format: betaZodOutputFormat(opts.schema),
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
    ...(useFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const } : {}),
  });
  const message = await stream.finalMessage();

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  debug(opts.label, `response (stop_reason=${message.stop_reason})`, text);

  if (message.stop_reason === "refusal") {
    const details = message.stop_details;
    throw new GenerationError(
      `${opts.label}: model refused` +
        (details ? ` (category ${details.category ?? "none"}: ${details.explanation ?? ""})` : ""),
      opts.label,
      text,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError(
      `${opts.label}: output truncated at max_tokens=${opts.maxTokens}`,
      opts.label,
      text,
    );
  }

  const usage = message.usage;
  return {
    text,
    servedModel: message.model,
    tokensIn:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    tokensOut: usage.output_tokens,
  };
}

/** Keep error text fed back to the model short enough to be useful. */
function capError(message: string, limit = 1500): string {
  return message.length > limit ? `${message.slice(0, limit)} ... (truncated)` : message;
}

/** Validate raw text against the schema and the optional check. Returns data or an error string. */
function validate<S extends z.ZodType>(
  opts: GenerateOptions<S>,
  text: string,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${(error as Error).message}` };
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `schema validation failed: ${capError(z.prettifyError(parsed.error))}` };
  }
  const data = opts.normalize ? opts.normalize(parsed.data) : parsed.data;
  const problem = opts.check?.(data) ?? null;
  if (problem) return { ok: false, error: `content check failed: ${capError(problem)}` };
  return { ok: true, data };
}

/** Generate schema-valid structured output, retrying once on validation failure. */
export async function generateStructured<S extends z.ZodType>(
  opts: GenerateOptions<S>,
): Promise<GenerateResult<z.infer<S>>> {
  const started = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let prompt = opts.prompt;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: Awaited<ReturnType<typeof callOnce>>;
    try {
      result = await callOnce(opts, prompt);
    } catch (error) {
      // The SDK validates structured output against the schema and throws on a
      // mismatch. Treat that like any other validation failure so the retry
      // runs, rather than letting it end the whole job.
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1 && /failed to parse structured output/i.test(message)) {
        console.error(`[llm:${opts.label}] attempt 1 rejected by the SDK parser: ${capError(message, 600)}`);
        prompt = retryPrompt(opts.prompt, capError(message, 600));
        continue;
      }
      throw error;
    }
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    costUsd += costOf(result.servedModel, result.tokensIn, result.tokensOut);

    const outcome = validate(opts, result.text);
    if (outcome.ok) {
      return {
        data: outcome.data,
        servedModel: result.servedModel,
        tokensIn,
        tokensOut,
        costUsd,
        ms: Date.now() - started,
        attempts: attempt,
      };
    }

    console.error(
      `[llm:${opts.label}] attempt ${attempt} failed: ${outcome.error}\n` +
        `raw response (first 1500 chars):\n${result.text.slice(0, 1500)}`,
    );
    if (attempt === 2) {
      throw new GenerationError(
        `${opts.label}: failed after retry: ${outcome.error}`,
        opts.label,
        result.text,
      );
    }
    prompt = retryPrompt(opts.prompt, outcome.error);
  }
  throw new Error("unreachable");
}

function retryPrompt(original: string, error: string): string {
  return (
    `${original}\n\n---\nYour previous output was rejected: ${error}\n` +
    `Produce the full output again, corrected. Follow every instruction above.`
  );
}
