/**
 * Line-level diff for reviewer edits.
 *
 * When a nurse edits a draft, what matters later is which lines changed, not a
 * character-level patch: the eval reads these rows to learn where the drafter
 * is consistently wrong. Small and deterministic on purpose.
 */

export interface LineChange {
  kind: "added" | "removed";
  line: number;
  text: string;
}

export interface LineDiff {
  changes: LineChange[];
  addedCount: number;
  removedCount: number;
  /** True when the texts are identical, so an "edit" that changed nothing is visible as such. */
  unchanged: boolean;
}

/**
 * Longest common subsequence over lines, then emit what was added and removed.
 * Drafts are a few dozen lines, so the quadratic table is not worth avoiding.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changes.push({ kind: "removed", line: i + 1, text: a[i] });
      i++;
    } else {
      changes.push({ kind: "added", line: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < a.length) changes.push({ kind: "removed", line: ++i, text: a[i - 1] });
  while (j < b.length) changes.push({ kind: "added", line: ++j, text: b[j - 1] });

  const addedCount = changes.filter((c) => c.kind === "added").length;
  const removedCount = changes.filter((c) => c.kind === "removed").length;
  return { changes, addedCount, removedCount, unchanged: changes.length === 0 };
}
