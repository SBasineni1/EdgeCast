import type { Aggregate } from "../types";

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

export function AggregateStrip({ aggregate }: { aggregate: Aggregate }) {
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
