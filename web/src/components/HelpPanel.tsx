import { useEffect, useRef } from "react";
import gsap from "gsap";

const FAQ: [string, string][] = [
  [
    "WHAT IS EDGECAST?",
    "It compares what Kalshi's daily high-temperature markets are pricing against what weather models predict for the same buckets, and grades everything against the official NWS observations that settle the markets. Research tool — not trading advice.",
  ],
  [
    "MARKET",
    "The probability implied by the market's current yes price.",
  ],
  [
    "MODEL",
    "The probability EdgeCast's consensus forecast assigns to that bucket.",
  ],
  [
    "EDGE",
    "Model minus market. ▲ green: the model thinks the bucket is more likely than the market is pricing. ▼ red: less likely. — means they roughly agree (difference below your FLAG ≥ threshold).",
  ],
  [
    "CONSENSUS",
    "An equal-weight blend of NBM, HRRR, and GFS after each model is corrected for its recent lean at that exact station — its average error over the last 15 graded days is subtracted before averaging. Bucket probabilities come from a bell curve centered on the consensus whose width is the consensus's own recent error spread in that city, so probabilities are tight where it has been sharp and wide where it hasn't.",
  ],
  [
    "OFF BY",
    "Mean absolute error of the model's day-ahead forecast vs the official observed high, over the last 30 days.",
  ],
  [
    "RIGHT BUCKET",
    "How often the model's forecast, rounded to a whole degree, landed inside the bucket that actually settled YES. RIGHT BUCKET 40% means: on 4 of every 10 recent days, this model pointed at the winning market the night before. Most ladders use 2°F buckets, so a blind guess sits near 12–15%.",
  ],
  [
    "RUNS WARM / COOL",
    "The model's average signed error. RUNS +0.9° WARM means it typically forecasts about a degree above what verifies; the consensus subtracts this lean out.",
  ],
  [
    "▸ MARKER",
    "The ladder row containing the rounded consensus forecast — the bucket the model would pick today.",
  ],
  [
    "⚠︎ MISMATCH",
    "Kalshi's settlement disagrees with what EdgeCast computes from the official observation. Rare — usually means the wrong station or a data correction; worth investigating.",
  ],
  [
    "DATA",
    "Kalshi public market API · Open-Meteo (NBM, HRRR, GFS live + archived day-ahead runs) · NOAA/NWS ACIS official observations. The ladder refreshes every 60 seconds; model grading updates as days settle.",
  ],
];

interface HelpPanelProps {
  onClose: () => void;
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce || ref.current === null) return;
    gsap.from(ref.current, { y: -8, autoAlpha: 0, duration: 0.25, ease: "power2.out" });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="help"
      data-testid="help-panel"
      className="fixed left-60 top-14 z-50 max-h-[80vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-hairline bg-panel-2 p-5"
    >
      <div className="flex items-baseline justify-between pb-3">
        <span className="text-xs font-bold tracking-[0.25em]">READING THIS DASHBOARD</span>
        <button
          onClick={onClose}
          aria-label="close help"
          className="rounded-full border border-hairline px-2 text-xs text-text-2"
        >
          ✕
        </button>
      </div>
      <dl className="flex flex-col gap-3">
        {FAQ.map(([term, def]) => (
          <div key={term}>
            <dt className="text-[10px] tracking-[0.2em] text-text-2">{term}</dt>
            <dd className="pt-0.5 text-xs leading-relaxed text-text-3">{def}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
