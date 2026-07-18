import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { CityInfo, ScenarioResult } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { formatDate, formatSigned, formatTemperature, rangeLabel } from "../format";

const SOURCE_ORDER = MODEL_ORDER.filter((m) => m !== "consensus");

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const flagged = results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
  if (flagged.length === 0) return null;
  return flagged.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  return (
    <span className="data-nums text-[11px] text-text-3" title="difference from consensus">
      {Math.abs(delta) < 0.05 ? "±0.0°" : `${formatSigned(delta, 1)}°`}
    </span>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-4">
      <p className="pb-2 text-xs font-medium text-text-3">{label}</p>
      {children}
    </div>
  );
}

interface CityHeroProps {
  location: string;
  cityInfo?: CityInfo;
  eventDate?: string;
  consensus: number | null;
  sigma?: number | null;
  modelHighs?: Record<string, number | null>;
  results?: ScenarioResult[];
}

export function CityHero({
  location,
  cityInfo,
  eventDate,
  consensus,
  sigma,
  modelHighs,
  results = [],
}: CityHeroProps) {
  const numRef = useRef<HTMLSpanElement>(null);

  // Count-up: animate from the previous displayed value to the new one.
  useEffect(() => {
    const el = numRef.current;
    if (el === null || consensus === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    const from = parseFloat(el.textContent ?? "") || 0;
    if (reduce) {
      el.textContent = formatTemperature(consensus);
      return;
    }
    const obj = { v: from };
    const tween = gsap.to(obj, {
      v: consensus,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = formatTemperature(obj.v);
      },
    });
    return () => {
      tween.kill();
    };
  }, [consensus]);

  const modelRows = SOURCE_ORDER.filter((m) => modelHighs?.[m] != null).map((m) => ({
    model: m,
    value: modelHighs![m] as number,
  }));
  const big = biggestEdge(results);
  const bigUp = big !== null && big.edge.flag === "model_higher";

  return (
    <section className="flex flex-col gap-4 pb-2" data-anim="hero">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-medium">{cityInfo?.name ?? location}</h1>
        <span className="text-xs text-text-3">
          {cityInfo ? `${cityInfo.station} · ` : ""}
          {eventDate ? formatDate(eventDate) : ""}
        </span>
      </div>
      <div className="grid divide-y divide-hairline rounded-xl border border-hairline bg-panel sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatCard label="Mean High">
          <p className="flex items-baseline gap-3">
            <span
              ref={numRef}
              data-testid="hero-temp"
              className="data-nums text-4xl font-medium tracking-tight"
            >
              {consensus !== null ? formatTemperature(consensus) : "—"}
            </span>
            {sigma != null && (
              <span className="data-nums rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-text-2">
                σ {formatTemperature(sigma)}
              </span>
            )}
          </p>
        </StatCard>
        <StatCard label="Biggest Edge">
          {big !== null ? (
            <p className="flex items-baseline gap-3" data-testid="hero-edge">
              <span
                className={`data-nums text-4xl font-medium tracking-tight ${
                  bigUp ? "text-up" : "text-down"
                }`}
              >
                {bigUp ? "+" : "−"}
                {Math.abs(big.edge.value).toFixed(2)}
              </span>
              <span
                className="data-nums text-[11px] text-text-2"
              >
                {bigUp ? "▲" : "▼"} {rangeLabel(big.market)}
              </span>
            </p>
          ) : (
            <p className="data-nums text-4xl font-medium tracking-tight text-text-3">—</p>
          )}
        </StatCard>
        <div
          className="flex flex-col justify-center p-4"
          aria-label="model highs"
        >
          {modelRows.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="hero-models">
              {modelRows.map(({ model, value }) => (
                <div key={model} className="data-nums flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-text-3">{MODEL_NAMES[model] ?? model}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{formatTemperature(value)}</span>
                    <DeltaChip delta={consensus !== null ? value - consensus : null} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="data-nums text-4xl font-medium tracking-tight text-text-3">—</p>
          )}
        </div>
      </div>
    </section>
  );
}
