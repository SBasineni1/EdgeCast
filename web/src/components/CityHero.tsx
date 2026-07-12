import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { CityInfo, ScenarioResult } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { formatDate, rangeLabel } from "../format";

const SOURCE_ORDER = MODEL_ORDER.filter((m) => m !== "consensus");

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const flagged = results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
  if (flagged.length === 0) return null;
  return flagged.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-sm">
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
      el.textContent = `${consensus.toFixed(1)}°`;
      return;
    }
    const obj = { v: from };
    const tween = gsap.to(obj, {
      v: consensus,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = `${obj.v.toFixed(1)}°`;
      },
    });
    return () => {
      tween.kill();
    };
  }, [consensus]);

  const sourceHighs = SOURCE_ORDER.filter((m) => modelHighs?.[m] != null)
    .map((m) => `${MODEL_NAMES[m]} ${(modelHighs![m] as number).toFixed(1)}`)
    .join(" · ");
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
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Consensus high">
          <p className="flex items-baseline gap-3">
            <span
              ref={numRef}
              data-testid="hero-temp"
              className="font-display text-4xl font-medium tabular-nums tracking-tight"
            >
              {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
            </span>
            {sigma != null && (
              <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] tabular-nums text-text-2">
                σ {sigma.toFixed(1)}°
              </span>
            )}
          </p>
        </StatCard>
        <StatCard label="Biggest edge">
          {big !== null ? (
            <p className="flex items-baseline gap-3" data-testid="hero-edge">
              <span
                className={`font-display text-4xl font-medium tabular-nums tracking-tight ${
                  bigUp ? "text-up" : "text-down"
                }`}
              >
                {bigUp ? "+" : "−"}
                {Math.abs(big.edge.value).toFixed(2)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                  bigUp ? "bg-up/10 text-up" : "bg-down/10 text-down"
                }`}
              >
                {bigUp ? "▲" : "▼"} {rangeLabel(big.market)}
              </span>
            </p>
          ) : (
            <p className="font-display text-4xl font-medium tabular-nums tracking-tight text-text-3">—</p>
          )}
        </StatCard>
        <StatCard label="Model highs">
          {sourceHighs ? (
            <p className="pt-1 text-sm leading-6 tabular-nums text-text-2" data-testid="hero-models">
              {sourceHighs}
            </p>
          ) : (
            <p className="font-display text-4xl font-medium tabular-nums tracking-tight text-text-3">—</p>
          )}
        </StatCard>
      </div>
    </section>
  );
}
