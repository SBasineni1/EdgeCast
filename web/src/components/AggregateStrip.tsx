import type { Aggregate, VerificationInfo } from "../types";

const VERDICT: Record<"model" | "market" | "tie", string> = {
  model: "MODEL BETTER CALIBRATED",
  market: "MARKET BETTER CALIBRATED",
  tie: "MARKET AND MODEL TIED",
};

function fmtBrier(x: number | null): string {
  return x === null ? "—" : x.toFixed(3).replace(/^0/, "");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] text-text-3">{label}</div>
      <div className="text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface AggregateStripProps {
  aggregate: Aggregate;
  verification?: VerificationInfo | null;
}

export function AggregateStrip({ aggregate, verification }: AggregateStripProps) {
  if (verification === null) {
    return (
      <section className="flex items-end border-b border-hairline px-6 py-5">
        <p
          className="ml-auto text-xl font-bold tracking-[0.1em] text-text-3"
          data-testid="verdict"
        >
          AWAITING VERIFICATION — run: uv run edgecast backfill
        </p>
      </section>
    );
  }
  if (verification !== undefined) {
    return (
      <section className="flex flex-wrap items-end gap-x-10 gap-y-3 border-b border-hairline px-6 py-5">
        <Stat label="MARKETS" value={String(verification.n_markets)} />
        <Stat label="DAYS" value={String(verification.n_days)} />
        <Stat label="BRIER MKT" value={fmtBrier(verification.mean_brier_market)} />
        <Stat label="BRIER MDL" value={fmtBrier(verification.mean_brier_model)} />
        <Stat
          label="HIT MKT / MDL"
          value={`${Math.round(verification.hit_rate_market * 100)}% / ${Math.round(
            verification.hit_rate_model * 100,
          )}%`}
        />
        <p
          className="ml-auto text-xl font-bold tracking-[0.1em]"
          data-testid="verdict"
        >
          {VERDICT[verification.better_calibrated]} · VERIFIED: LAST{" "}
          {verification.window_days} DAYS
        </p>
      </section>
    );
  }
  const verdict = aggregate.better_calibrated
    ? VERDICT[aggregate.better_calibrated]
    : "AWAITING SETTLEMENTS";
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-3 border-b border-hairline px-6 py-5">
      <Stat label="SCENARIOS" value={String(aggregate.n_scenarios)} />
      <Stat label="SETTLED" value={String(aggregate.n_settled)} />
      <Stat label="BRIER MKT" value={fmtBrier(aggregate.mean_brier_market)} />
      <Stat label="BRIER MDL" value={fmtBrier(aggregate.mean_brier_model)} />
      <p
        className="ml-auto text-xl font-bold tracking-[0.1em]"
        data-testid="verdict"
      >
        {verdict}
      </p>
    </section>
  );
}
