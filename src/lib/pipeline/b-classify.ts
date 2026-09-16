/**
 * Stage B: classify the denial (PRD 7 stage B).
 *
 * The first LLM call. Reads the payer's letter and the claim adjustment codes
 * and reports what the payer is asserting: the category, the specific root
 * cause from a fixed enum, the facts the payer relies on, and a confidence.
 *
 * Deliberately not given the chart. Stage B's job is to read the denial, and
 * feeding it the record would let it argue the case instead of classifying it.
 */

import { z } from "zod";
import {
  DENIAL_CATEGORIES,
  ROOT_CAUSES,
  ROOT_CAUSES_BY_CATEGORY,
  isRootCauseValidForCategory,
  type DocType,
} from "../domain";
import { generateStructured } from "../llm";
import { MODELS } from "../models";
import { loadStagePrompts, renderTemplate } from "../prompts";

export const CLASSIFY_PROMPT_VERSION = "classify.v1";

/** Shape only; the count and range rules live in checkClassify so they can retry. */
export const ClassifySchema = z.object({
  category: z.enum(DENIAL_CATEGORIES),
  root_cause: z.enum(ROOT_CAUSES),
  key_facts: z.array(z.string()),
  confidence: z.number(),
});
export type ClassifyOutput = z.infer<typeof ClassifySchema>;

export interface ClassifyInput {
  conditionLabel: string;
  carc: string;
  rarc: string;
  docTypes: DocType[];
  letterText: string;
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  hp: "history and physical",
  progress: "progress note",
  discharge: "discharge summary",
};

/**
 * Deterministic checks. The root cause enum is shared across categories, so a
 * schema-valid answer can still pair a root cause with a category it does not
 * belong to; that is caught here and fed back on the retry.
 */
export function checkClassify(output: ClassifyOutput): string | null {
  const problems: string[] = [];

  if (!isRootCauseValidForCategory(output.category, output.root_cause)) {
    problems.push(
      `root_cause "${output.root_cause}" is not valid for category "${output.category}". ` +
        `Allowed: ${ROOT_CAUSES_BY_CATEGORY[output.category].join(", ")}`,
    );
  }
  if (output.key_facts.length < 3 || output.key_facts.length > 6) {
    problems.push(`key_facts has ${output.key_facts.length} entries; 3 to 6 are required`);
  }
  if (output.key_facts.some((f) => f.trim().length === 0)) {
    problems.push("key_facts contains an empty entry");
  }
  if (!(output.confidence >= 0 && output.confidence <= 1)) {
    problems.push(`confidence ${output.confidence} is outside 0 to 1`);
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

export function renderClassifyPrompt(input: ClassifyInput): { system: string; user: string } {
  const { system, userTemplate } = loadStagePrompts("classify", CLASSIFY_PROMPT_VERSION.split(".")[1]);
  const seen = [...new Set(input.docTypes)];
  return {
    system,
    user: renderTemplate(userTemplate, {
      condition_label: input.conditionLabel,
      carc: input.carc,
      rarc: input.rarc,
      doc_types: seen.map((t) => DOC_TYPE_LABELS[t]).join(", "),
      letter_text: input.letterText.trim(),
    }),
  };
}

export async function classify(input: ClassifyInput, onText?: (chunk: string) => void) {
  const { system, user } = renderClassifyPrompt(input);
  return generateStructured({
    label: "stage-b-classify",
    model: MODELS.classify,
    system,
    prompt: user,
    schema: ClassifySchema,
    maxTokens: 4000,
    effort: "low",
    cacheSystem: true,
    normalize: (o) => ({ ...o, key_facts: o.key_facts.map((f) => f.trim()).filter(Boolean) }),
    check: checkClassify,
    onText,
  });
}
