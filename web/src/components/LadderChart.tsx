import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { ScenarioResult } from "../types";
import { formatPercent, markedScenarioId, shortRangeLabel, sortKey } from "../format";

const W = 640;
const H = 210;
const PAD_X = 28;
const PAD_TOP = 20;
const PAD_BOTTOM = 34;
const TIP_W = 118;
const TIP_H = 62;

function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return PAD_X + (i * (W - 2 * PAD_X)) / (n - 1);
}

function yAt(p: number): number {
  return PAD_TOP + (1 - p) * (H - PAD_TOP - PAD_BOTTOM);
}

function linePath(probs: number[]): string {
  return probs
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i, probs.length).toFixed(1)},${yAt(p).toFixed(1)}`)
    .join(" ");
}

interface LadderChartProps {
  results: ScenarioResult[];
  consensus: number | null;
}

export function LadderChart({ results, consensus }: LadderChartProps) {
  const marketRef = useRef<SVGPathElement>(null);
  const modelRef = useRef<SVGPathElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const n = sorted.length;
  const signature = sorted.map((r) => `${r.scenario_id}:${r.market_prob}:${r.model_prob}`).join("|");

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    const paths = [marketRef.current, modelRef.current].filter(
      (p): p is SVGPathElement => p !== null && typeof p.getTotalLength === "function",
    );
    const tweens = paths.map((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      return gsap.to(p, { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" });
    });
    return () => tweens.forEach((t) => t.kill());
  }, [signature]);

  if (n < 2) return null;

  const marketD = linePath(sorted.map((r) => r.market_prob));
  const modelD = linePath(sorted.map((r) => r.model_prob));
  const markedId = markedScenarioId(sorted, consensus);
  const markedIdx = sorted.findIndex((r) => r.scenario_id === markedId);

  return (
    <section className="rounded-xl border border-hairline bg-panel p-5" data-anim="chart">
      <div className="flex items-center justify-between pb-4">
        <p className="text-xs font-medium text-text-3">Temperature Probabilities</p>
        <div className="flex items-center gap-4 text-xs text-text-2">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-market" aria-hidden="true" />
            Market
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-model" aria-hidden="true" />
            Model
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="market vs model probability by temperature bucket"
        data-testid="ladder-chart"
      >
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={yAt(p)}
            y2={yAt(p)}
            stroke="var(--color-hairline)"
            strokeDasharray="3 5"
          />
        ))}
        {markedIdx >= 0 && (
          <line
            x1={xAt(markedIdx, n)}
            x2={xAt(markedIdx, n)}
            y1={PAD_TOP}
            y2={H - PAD_BOTTOM}
            stroke="var(--color-chart-marker)"
            strokeDasharray="2 5"
            data-testid="chart-consensus-line"
          />
        )}
        <path
          ref={marketRef}
          d={marketD}
          fill="none"
          stroke="var(--color-market)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="market-line"
        />
        <path
          ref={modelRef}
          d={modelD}
          fill="none"
          stroke="var(--color-model)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="model-line"
        />
        {hovered !== null &&
          (() => {
            const i = hovered;
            const r = sorted[i];
            const hx = xAt(i, n);
            const flip = hx + 14 + TIP_W > W - PAD_X;
            const tipX = flip ? hx - 14 - TIP_W : hx + 14;
            return (
              <g pointerEvents="none">
                <rect
                  data-testid="chart-hover-band"
                  x={hx - 17}
                  width={34}
                  y={PAD_TOP}
                  height={H - PAD_TOP - PAD_BOTTOM}
                  rx={6}
                  fill="var(--color-chart-hover)"
                />
                <circle cx={hx} cy={yAt(r.market_prob)} r={3.5} fill="var(--color-market)" />
                <circle cx={hx} cy={yAt(r.model_prob)} r={3.5} fill="var(--color-model)" />
                <g data-testid="chart-hover-tip">
                  <rect
                    x={tipX}
                    y={PAD_TOP}
                    width={TIP_W}
                    height={TIP_H}
                    rx={10}
                    fill="var(--color-panel)"
                    stroke="var(--color-hairline)"
                  />
                  <text x={tipX + 12} y={PAD_TOP + 17} fontSize="10" fill="var(--color-text-3)">
                    {shortRangeLabel(r.market)}
                  </text>
                  <circle cx={tipX + 15} cy={PAD_TOP + 32} r={3} fill="var(--color-market)" />
                  <text x={tipX + 24} y={PAD_TOP + 36} fontSize="11" fill="var(--color-text-1)">
                    Market {formatPercent(r.market_prob)}
                  </text>
                  <circle cx={tipX + 15} cy={PAD_TOP + 48} r={3} fill="var(--color-model)" />
                  <text x={tipX + 24} y={PAD_TOP + 52} fontSize="11" fill="var(--color-text-1)">
                    Model {formatPercent(r.model_prob)}
                  </text>
                </g>
              </g>
            );
          })()}
        <g onMouseLeave={() => setHovered(null)}>
          {sorted.map((r, i) => {
            const prev = i === 0 ? PAD_X : (xAt(i - 1, n) + xAt(i, n)) / 2;
            const next = i === n - 1 ? W - PAD_X : (xAt(i, n) + xAt(i + 1, n)) / 2;
            return (
              <rect
                key={r.scenario_id}
                data-testid="chart-hover-zone"
                x={prev}
                width={next - prev}
                y={PAD_TOP}
                height={H - PAD_TOP - PAD_BOTTOM}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
            );
          })}
        </g>
        {sorted.map((r, i) => (
          <text
            key={r.scenario_id}
            x={xAt(i, n)}
            y={H - 12}
            textAnchor="middle"
            fontSize="11"
            fill="var(--color-text-3)"
          >
            {shortRangeLabel(r.market)}
          </text>
        ))}
      </svg>
    </section>
  );
}
