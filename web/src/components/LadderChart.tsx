import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { ScenarioResult } from "../types";
import { markedScenarioId, shortRangeLabel, sortKey } from "../format";

const W = 640;
const H = 210;
const PAD_X = 28;
const PAD_TOP = 20;
const PAD_BOTTOM = 34;
const PILL_W = 96;
const PILL_H = 22;
const PLOT_RIGHT = W - PAD_X - PILL_W - 10;

function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return PAD_X + (i * (PLOT_RIGHT - PAD_X)) / (n - 1);
}

function yAt(p: number): number {
  return PAD_TOP + (1 - p) * (H - PAD_TOP - PAD_BOTTOM);
}

function linePath(probs: number[]): string {
  return probs
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i, probs.length).toFixed(1)},${yAt(p).toFixed(1)}`)
    .join(" ");
}

/** Nudge pill centers apart when the two line ends nearly overlap. */
function pillYs(a: number, b: number): [number, number] {
  if (Math.abs(a - b) >= PILL_H + 4) return [a, b];
  const mid = (a + b) / 2;
  const off = (PILL_H + 4) / 2;
  return a <= b ? [mid - off, mid + off] : [mid + off, mid - off];
}

function Pill({ x, y, fill, label }: { x: number; y: number; fill: string; label: string }) {
  return (
    <g>
      <rect x={x} y={y - PILL_H / 2} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill={fill} />
      <text
        x={x + PILL_W / 2}
        y={y + 3.5}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="#141609"
      >
        {label}
      </text>
    </g>
  );
}

interface LadderChartProps {
  results: ScenarioResult[];
  consensus: number | null;
}

export function LadderChart({ results, consensus }: LadderChartProps) {
  const marketRef = useRef<SVGPathElement>(null);
  const modelRef = useRef<SVGPathElement>(null);
  const pillsRef = useRef<SVGGElement>(null);
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
    if (pillsRef.current !== null) {
      tweens.push(
        gsap.fromTo(
          pillsRef.current,
          { scale: 0.8, autoAlpha: 0 },
          {
            scale: 1,
            autoAlpha: 1,
            transformOrigin: "left center",
            duration: 0.3,
            delay: 0.7,
            ease: "back.out(2)",
          },
        ),
      );
    }
    return () => tweens.forEach((t) => t.kill());
  }, [signature]);

  if (n < 2) return null;

  const marketD = linePath(sorted.map((r) => r.market_prob));
  const modelD = linePath(sorted.map((r) => r.model_prob));
  const last = sorted[n - 1];
  const lastX = xAt(n - 1, n);
  const [pillMarketY, pillModelY] = pillYs(yAt(last.market_prob), yAt(last.model_prob));
  const markedId = markedScenarioId(sorted, consensus);
  const markedIdx = sorted.findIndex((r) => r.scenario_id === markedId);

  return (
    <section className="rounded-2xl bg-panel p-5" data-anim="chart">
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
            stroke="rgba(255,255,255,0.07)"
            strokeDasharray="3 5"
          />
        ))}
        {markedIdx >= 0 && (
          <line
            x1={xAt(markedIdx, n)}
            x2={xAt(markedIdx, n)}
            y1={PAD_TOP}
            y2={H - PAD_BOTTOM}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="2 5"
            data-testid="chart-consensus-line"
          />
        )}
        <path
          ref={marketRef}
          d={marketD}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(232,197,71,0.35))" }}
          data-testid="market-line"
        />
        <path
          ref={modelRef}
          d={modelD}
          fill="none"
          stroke="var(--color-lime)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(185,246,65,0.4))" }}
          data-testid="model-line"
        />
        {hovered === null && (
          <g ref={pillsRef}>
            <Pill
              x={lastX + 10}
              y={pillModelY}
              fill="var(--color-lime)"
              label={`MODEL ${Math.round(last.model_prob * 100)}%`}
            />
            <Pill
              x={lastX + 10}
              y={pillMarketY}
              fill="var(--color-gold)"
              label={`MARKET ${Math.round(last.market_prob * 100)}%`}
            />
          </g>
        )}
        {hovered !== null &&
          (() => {
            const i = hovered;
            const r = sorted[i];
            const hx = xAt(i, n);
            const flip = hx + 22 + PILL_W > W - PAD_X;
            const tipX = flip ? hx - 22 - PILL_W : hx + 22;
            const tipTopY = PAD_TOP + PILL_H / 2 + 2;
            const tipBottomY = tipTopY + PILL_H + 4;
            return (
              <g pointerEvents="none">
                <rect
                  data-testid="chart-hover-band"
                  x={hx - 17}
                  width={34}
                  y={PAD_TOP}
                  height={H - PAD_TOP - PAD_BOTTOM}
                  rx={6}
                  fill="rgba(255,255,255,0.05)"
                />
                <circle
                  cx={hx}
                  cy={yAt(r.market_prob)}
                  r={3.5}
                  fill="var(--color-gold)"
                  style={{ filter: "drop-shadow(0 0 6px rgba(232,197,71,0.35))" }}
                />
                <circle
                  cx={hx}
                  cy={yAt(r.model_prob)}
                  r={3.5}
                  fill="var(--color-lime)"
                  style={{ filter: "drop-shadow(0 0 6px rgba(185,246,65,0.4))" }}
                />
                <g data-testid="chart-hover-tip">
                  <Pill
                    x={tipX}
                    y={tipTopY}
                    fill="var(--color-gold)"
                    label={`MARKET ${Math.round(r.market_prob * 100)}%`}
                  />
                  <Pill
                    x={tipX}
                    y={tipBottomY}
                    fill="var(--color-lime)"
                    label={`MODEL ${Math.round(r.model_prob * 100)}%`}
                  />
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
