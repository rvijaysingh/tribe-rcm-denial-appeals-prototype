import {
  DEFAULT_BOX,
  domainFor,
  labelIndices,
  linePath,
  makeScale,
  ticks,
  type ChartBox,
} from "@/lib/dashboard/chart";
import type { SeriesPoint } from "@/lib/dashboard/series";
import { cn } from "@/lib/utils";

/**
 * A small SVG line chart with optional reference lines and one highlighted
 * point. Server-rendered: there is no interaction here beyond native title
 * tooltips, so it ships no client JavaScript.
 */

export interface ReferenceLine {
  value: number;
  label: string;
  tone?: "muted" | "target";
}

export interface Highlight {
  value: number;
  label: string;
  /** Small caption under the value, such as the delta against the average. */
  caption?: string;
}

export function LineChart({
  points,
  references = [],
  highlight,
  formatValue,
  box = DEFAULT_BOX,
  maxLabels = 8,
}: {
  points: SeriesPoint[];
  references?: ReferenceLine[];
  /** Appended as one extra point on the right, drawn in the accent colour. */
  highlight?: Highlight;
  formatValue: (value: number) => string;
  box?: ChartBox;
  maxLabels?: number;
}) {
  const values = points.map((p) => p.value);
  const allValues = highlight ? [...values, highlight.value] : values;
  const { min, max } = domainFor(allValues, references.map((r) => r.value));
  const count = points.length + (highlight ? 1 : 0);
  const scale = makeScale(count, min, max, box);

  const path = linePath(values, scale);
  const yTicks = ticks(scale, 4);
  const keepLabels = new Set(labelIndices(points.length, maxLabels));
  const highlightIndex = count - 1;

  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      className="h-[240px] w-full"
      role="img"
      aria-label={`Line chart, ${points.length} points`}
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={box.padLeft}
            x2={box.width - box.padRight}
            y1={scale.y(t)}
            y2={scale.y(t)}
            stroke="#e4e4e7"
            strokeWidth={1}
          />
          <text x={box.padLeft - 6} y={scale.y(t) + 3} textAnchor="end" className="fill-zinc-400 text-[9px]">
            {formatValue(t)}
          </text>
        </g>
      ))}

      {references.map((ref) => (
        <g key={ref.label}>
          <line
            x1={box.padLeft}
            x2={box.width - box.padRight}
            y1={scale.y(ref.value)}
            y2={scale.y(ref.value)}
            stroke={ref.tone === "target" ? "#16a34a" : "#a1a1aa"}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text
            x={box.width - box.padRight}
            y={scale.y(ref.value) - 4}
            textAnchor="end"
            className={cn("text-[9.5px]", ref.tone === "target" ? "fill-green-700" : "fill-zinc-500")}
          >
            {ref.label}
          </text>
        </g>
      ))}

      <path d={path} fill="none" stroke="#71717a" strokeWidth={1.75} strokeLinejoin="round" />

      {points.map((p, i) => (
        <circle key={p.iso} cx={scale.x(i)} cy={scale.y(p.value)} r={2} fill="#71717a">
          <title>{`${p.label}: ${formatValue(p.value)}`}</title>
        </circle>
      ))}

      {points.map((p, i) =>
        keepLabels.has(i) ? (
          <text
            key={`l-${p.iso}`}
            x={scale.x(i)}
            y={box.height - box.padBottom + 14}
            textAnchor="middle"
            className="fill-zinc-400 text-[9px]"
          >
            {p.label}
          </text>
        ) : null,
      )}

      {highlight ? (
        <g>
          <line
            x1={scale.x(highlightIndex)}
            x2={scale.x(highlightIndex)}
            y1={box.padTop}
            y2={box.height - box.padBottom}
            stroke="#2563eb"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.35}
          />
          <circle cx={scale.x(highlightIndex)} cy={scale.y(highlight.value)} r={5} fill="#2563eb">
            <title>{`${highlight.label}: ${formatValue(highlight.value)}`}</title>
          </circle>
          <text
            x={scale.x(highlightIndex)}
            y={scale.y(highlight.value) - 12}
            textAnchor="end"
            className="fill-blue-700 text-[11px] font-semibold"
          >
            {formatValue(highlight.value)}
          </text>
          {highlight.caption ? (
            <text
              x={scale.x(highlightIndex)}
              y={scale.y(highlight.value) - 1}
              textAnchor="end"
              className="fill-blue-600 text-[9.5px]"
            >
              {highlight.caption}
            </text>
          ) : null}
          <text
            x={scale.x(highlightIndex)}
            y={box.height - box.padBottom + 14}
            textAnchor="middle"
            className="fill-blue-700 text-[9px] font-semibold"
          >
            {highlight.label}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
