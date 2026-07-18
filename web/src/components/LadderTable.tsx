import type { ScenarioResult } from "../types";
import { formatPercent, formatSigned, markedScenarioId, rangeLabel, sortKey } from "../format";

const GRID = "grid grid-cols-[1fr_3rem_3rem_4.5rem] items-center gap-2 sm:grid-cols-[1fr_5.5rem_5.5rem_6rem] sm:gap-4";

function ProbCell({ value, tone }: { value: number; tone: "market" | "model" }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <span className="data-nums text-sm">{formatPercent(value)}</span>
      <div className="mt-1 h-1 rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full ${tone === "market" ? "bg-market" : "bg-model"}`}
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
      <span className="data-nums justify-self-end text-sm" data-testid="edge-cell">
        {won ? "YES ●" : "NO"}
      </span>
    );
  }
  if (r.edge.flag === "agreement") {
    return (
      <span className="data-nums justify-self-end text-xs text-text-3" data-testid="edge-cell">
        {formatSigned(r.edge.value)}
      </span>
    );
  }
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`data-nums justify-self-end text-xs font-medium ${
        up ? "text-up" : "text-down"
      }`}
      title={up ? "model higher" : "market higher"}
      data-testid="edge-cell"
    >
      {up ? "▲ " : "▼ "}
      {formatSigned(r.edge.value)}
    </span>
  );
}

interface LadderTableProps {
  results: ScenarioResult[];
  consensus: number | null;
}

export function LadderTable({ results, consensus }: LadderTableProps) {
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const markedId = markedScenarioId(sorted, consensus);
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5" data-anim="table" data-testid="ladder-table">
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
                <span className="pr-1 text-model" title="consensus lands here" data-testid="consensus-marker">
                  ▸
                </span>
              )}
              {rangeLabel(r.market)}
            </span>
            <ProbCell value={r.market_prob} tone="market" />
            <ProbCell value={r.model_prob} tone="model" />
            <EdgeCell r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}
