import type { ScenarioResult } from "../types";
import { ProbBar } from "./ProbBar";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

const FLAG_TEXT = {
  model_higher: "MODEL HIGHER",
  market_higher: "MARKET HIGHER",
} as const;

export function MarketCard({ result }: { result: ScenarioResult }) {
  const { market, edge, settlement } = result;
  const clamped = result.model_prob_raw !== result.model_prob;
  return (
    <article className="space-y-3 border border-hairline bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs uppercase tracking-[0.15em]">{market.question}</h3>
        <span className="shrink-0 text-xs text-text-3">
          {formatDate(market.event_date)}
        </span>
      </header>
      <div className="space-y-2">
        <ProbBar label="MARKET" value={result.market_prob} variant="solid" />
        <ProbBar label="MODEL" value={result.model_prob} variant="hatched" />
        {clamped && (
          <p className="pl-[76px] text-[10px] text-text-3">
            raw {result.model_prob_raw.toFixed(2)} → {result.model_prob.toFixed(2)}
          </p>
        )}
      </div>
      {edge.flag === "agreement" ? (
        <p className="text-sm text-text-3" data-testid="edge-agreement">
          — AGREEMENT
        </p>
      ) : (
        <p
          className="text-sm text-signal"
          style={{ textShadow: "0 0 8px rgba(255, 106, 0, 0.45)" }}
          data-testid="edge-flag"
        >
          {edge.value >= 0 ? "▲ +" : "▼ "}
          {edge.value.toFixed(2)} {FLAG_TEXT[edge.flag]}
        </p>
      )}
      <footer className="border-t border-hairline pt-2 text-xs text-text-2">
        {settlement ? (
          <>
            <p>
              SETTLED {settlement.outcome === 1 ? "YES" : "NO"} · OBSERVED{" "}
              {settlement.observed_value}
            </p>
            <p>
              BRIER MKT {settlement.brier_market.toFixed(3)}
              {settlement.brier_market < settlement.brier_model ? " ●" : ""} · MDL{" "}
              {settlement.brier_model.toFixed(3)}
              {settlement.brier_model < settlement.brier_market ? " ●" : ""}
            </p>
          </>
        ) : (
          <p className="text-text-3">AWAITING OBSERVATION</p>
        )}
      </footer>
    </article>
  );
}
