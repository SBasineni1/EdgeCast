import type { KalshiMismatch, ScenarioResult } from "../types";
import { markedScenarioId, rangeLabel, sortKey } from "../format";

const GRID = "grid grid-cols-[1fr_5.5rem_5.5rem_6rem] items-center gap-4";

function ProbCell({ value, tone }: { value: number; tone: "gold" | "lime" }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <span className="text-sm tabular-nums">{Math.round(value * 100)}%</span>
      <div className="mt-1 h-1 rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full ${tone === "gold" ? "bg-gold" : "bg-lime"}`}
          style={{ width: `${pct}%`, transition: "width 300ms ease-out" }}
        />
      </div>
    </div>
  );
}

function EdgeCell({ r }: { r: ScenarioResult }) {
  if (r.settlement !== null) {
    const won = r.settlement.outcome === 1;
    return (
      <span className="justify-self-end text-sm tabular-nums" data-testid="edge-cell">
        {won ? "YES ●" : "NO"}
      </span>
    );
  }
  if (r.edge.flag === "agreement") {
    return (
      <span className="justify-self-end text-text-3" data-testid="edge-cell">
        —
      </span>
    );
  }
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`justify-self-end rounded-full px-2.5 py-1 text-xs tabular-nums ${
        up ? "bg-up/10 text-up" : "bg-down/10 text-down"
      }`}
      title={up ? "model higher" : "market higher"}
      data-testid="edge-cell"
    >
      {up ? "▲ +" : "▼ "}
      {r.edge.value.toFixed(2)}
    </span>
  );
}

interface LadderTableProps {
  results: ScenarioResult[];
  consensus: number | null;
  mismatches: KalshiMismatch[];
}

export function LadderTable({ results, consensus, mismatches }: LadderTableProps) {
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const markedId = markedScenarioId(sorted, consensus);
  return (
    <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm" data-anim="table" data-testid="ladder-table">
      <div className={`${GRID} pb-3 text-xs font-medium text-text-3`}>
        <span>Range</span>
        <span>Market</span>
        <span>Model</span>
        <span className="justify-self-end">Edge</span>
      </div>
      <ul>
        {sorted.map((r) => (
          <li
            key={r.scenario_id}
            className={`${GRID} border-b border-hairline py-3 text-sm last:border-0`}
            data-testid="ladder-row"
          >
            <span>
              {r.scenario_id === markedId && (
                <span className="pr-1 text-lime" title="consensus lands here" data-testid="consensus-marker">
                  ▸
                </span>
              )}
              {rangeLabel(r.market)}
            </span>
            <ProbCell value={r.market_prob} tone="gold" />
            <ProbCell value={r.model_prob} tone="lime" />
            <EdgeCell r={r} />
          </li>
        ))}
      </ul>
      {mismatches.length > 0 && (
        <footer className="pt-3 text-xs">
          {mismatches.map((m) => (
            <p key={m.market_id} className="text-down" data-testid="mismatch-warning">
              ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
              {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
            </p>
          ))}
        </footer>
      )}
    </section>
  );
}
