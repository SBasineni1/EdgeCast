import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { CityInfo } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { formatDate } from "../format";

const SOURCE_ORDER = MODEL_ORDER.filter((m) => m !== "consensus");

interface CityHeroProps {
  location: string;
  cityInfo?: CityInfo;
  eventDate?: string;
  consensus: number | null;
  sigma?: number | null;
  modelHighs?: Record<string, number | null>;
}

export function CityHero({ location, cityInfo, eventDate, consensus, sigma, modelHighs }: CityHeroProps) {
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

  return (
    <section className="pb-2" data-anim="hero">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-medium">{cityInfo?.name ?? location}</h1>
        <span className="text-xs tracking-[0.15em] text-text-3">
          {cityInfo ? `${cityInfo.station.toUpperCase()} · ` : ""}
          {eventDate ? formatDate(eventDate) : ""}
        </span>
      </div>
      <p className="pt-2 text-[10px] tracking-[0.3em] text-text-3">CONSENSUS HIGH</p>
      <p className="pt-1">
        <span ref={numRef} data-testid="hero-temp" className="text-6xl font-medium tabular-nums tracking-tight">
          {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
        </span>
        {sigma != null && <span className="pl-3 text-sm tabular-nums text-text-3">σ {sigma.toFixed(1)}°</span>}
      </p>
      {sourceHighs && (
        <p className="pt-2 text-xs tabular-nums text-text-3" data-testid="hero-models">
          {sourceHighs}
        </p>
      )}
    </section>
  );
}
