/**
 * Stage A rule-test metric (PRD 9.2): the unit test pass rate.
 *
 * The suite is the source of truth for the deterministic stages, so the eval
 * shells out to vitest rather than restating a number by hand. A failure to
 * run the suite is reported and returns null; it never fails the eval, because
 * a missing metric is better than losing a paid pipeline run.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RuleTestResult {
  n: number;
  of: number;
}

interface VitestJson {
  numPassedTests?: number;
  numTotalTests?: number;
}

export async function runRuleTests(): Promise<RuleTestResult | null> {
  const dir = mkdtempSync(join(tmpdir(), "eval-rule-tests-"));
  const outputFile = join(dir, "vitest.json");
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`],
        { stdio: "ignore", shell: process.platform === "win32" },
      );
      child.on("error", () => resolve(-1));
      child.on("close", (c) => resolve(c ?? -1));
    });

    if (code === -1) {
      console.warn("  rule tests: could not start vitest, metric recorded as not collected");
      return null;
    }

    const report = JSON.parse(readFileSync(outputFile, "utf8")) as VitestJson;
    if (typeof report.numPassedTests !== "number" || typeof report.numTotalTests !== "number") {
      console.warn("  rule tests: vitest report had no test counts, metric recorded as not collected");
      return null;
    }
    return { n: report.numPassedTests, of: report.numTotalTests };
  } catch (error) {
    console.warn(
      `  rule tests: ${error instanceof Error ? error.message : String(error)}, metric recorded as not collected`,
    );
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
