/**
 * npm run pipeline -- --case <id>
 *
 * Runs the full pipeline on one case from the CLI and persists the run. Prints
 * each stage as it lands, then the route and the cost.
 *
 * Flags:
 *   --case <id>    the denial to run (required)
 *   --letter       print the rendered appeal letter
 *   --json         print the whole run result as JSON instead of a report
 *   --stream       print draft text as it streams
 */

import "./seed/load-env";
import { closeDb } from "../src/lib/db/client";
import { formatUsd, toCents } from "../src/lib/money";
import { MODELS } from "../src/lib/models";
import { runPipeline, type StageEvent } from "../src/lib/pipeline/orchestrator";

export interface PipelineArgs {
  denialId: string;
  letter: boolean;
  json: boolean;
  stream: boolean;
}

export function parsePipelineArgs(argv: string[]): PipelineArgs {
  const flags = new Set(["--letter", "--json", "--stream"]);
  const caseIndex = argv.indexOf("--case");
  const denialId = caseIndex > -1 ? argv[caseIndex + 1] : undefined;
  if (!denialId || denialId.startsWith("--")) {
    throw new Error("Usage: npm run pipeline -- --case <DENIAL_ID> [--letter] [--json] [--stream]");
  }
  const unknown = argv.filter((a, i) => i !== caseIndex && i !== caseIndex + 1 && !flags.has(a));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);
  return {
    denialId,
    letter: argv.includes("--letter"),
    json: argv.includes("--json"),
    stream: argv.includes("--stream"),
  };
}

const STAGE_LABEL: Record<string, string> = {
  a_triage: "A triage  ",
  b_classify: "B classify",
  c_retrieve: "C retrieve",
  d_draft: "D draft   ",
  e_verify: "E verify  ",
};

async function main(): Promise<void> {
  const args = parsePipelineArgs(process.argv.slice(2));

  if (!args.json) {
    console.log(`Running ${args.denialId}`);
    console.log(`  models: classify=${MODELS.classify} draft=${MODELS.draft} verify=${MODELS.verify}\n`);
  }

  const onEvent = (event: StageEvent): void => {
    if (args.json) return;
    if (event.type === "stage_completed") {
      const seconds = (event.ms / 1000).toFixed(1).padStart(5);
      console.log(`  ${STAGE_LABEL[event.stage]} ${seconds}s  ${event.summary}`);
    } else if (event.type === "draft_token" && args.stream) {
      process.stdout.write(event.text);
    } else if (event.type === "run_failed") {
      console.error(`  run failed during ${event.stage ?? "setup"}: ${event.error}`);
    }
  };

  const result = await runPipeline(args.denialId, { onEvent });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n  route: ${result.route.toUpperCase()}`);
  console.log(`  ${result.routeReason}`);

  const v = result.verification;
  if (v) {
    console.log(
      `\n  citation validity ${(v.citation.validityRate * 100).toFixed(0)}% ` +
        `over ${v.citation.totalCitations} citations` +
        (v.citation.invalidChartLineIds.length + v.citation.invalidClauseIds.length > 0
          ? ` (invalid: ${[...v.citation.invalidChartLineIds, ...v.citation.invalidClauseIds].join(", ")})`
          : ""),
    );
    console.log(
      `  criteria coverage ${(v.coverage.coverage * 100).toFixed(0)}%` +
        (v.coverage.uncoveredRequiredClauseIds.length > 0
          ? ` (not argued: ${v.coverage.uncoveredRequiredClauseIds.join(", ")})`
          : ""),
    );
    if (v.judge) {
      console.log(
        `  judge: faithfulness ${v.judge.faithfulness.toFixed(2)}, completeness ${v.judge.completeness.toFixed(2)}, ` +
          `tone ${v.judge.tone.toFixed(2)}, overall ${v.judge.overall.toFixed(2)}`,
      );
      for (const flag of v.judge.flagged_assertions) {
        console.log(`    flagged: "${flag.assertion_text.slice(0, 90)}"`);
        console.log(`             ${flag.reason}`);
      }
    }
  }
  if (result.draft && result.draft.unsupported_required.length > 0) {
    console.log("\n  evidence needed:");
    for (const gap of result.draft.unsupported_required) {
      console.log(`    ${gap.clause_id}: ${gap.evidence_needed}`);
    }
  }

  console.log(
    `\n  run ${result.runId} in ${(result.totalMs / 1000).toFixed(1)}s, ` +
      `cost ${formatUsd(toCents(result.totalCostUsd))}`,
  );

  if (args.letter && result.letterText) console.log(`\n${result.letterText}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/pipeline.ts")) {
  main()
    .catch((error) => {
      console.error("pipeline failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
