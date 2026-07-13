import type { CityInfo, ScenarioResult } from "../types";

function flagged(results: ScenarioResult[]): ScenarioResult[] {
  return results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
}

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const rows = flagged(results);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

interface CityStripProps {
  groups: [string, ScenarioResult[]][];
  cities: Record<string, CityInfo>;
  modelHighs?: Record<string, Record<string, number | null>>;
  selected: string | null;
  onSelect: (location: string) => void;
}

export function CityStrip({ groups, cities, modelHighs, selected, onSelect }: CityStripProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 xl:hidden" data-testid="city-strip">
      {groups.map(([loc, results]) => {
        const consensus = modelHighs?.[loc]?.consensus ?? null;
        const big = biggestEdge(results);
        const active = loc === selected;
        return (
          <button
            key={loc}
            data-testid="city-chip"
            aria-pressed={active}
            onClick={() => onSelect(loc)}
            className={
              "flex shrink-0 items-baseline gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150 " +
              (active
                ? "border-lime bg-panel ring-1 ring-lime/30"
                : "border-hairline bg-panel")
            }
          >
            <span className="font-medium">{cities[loc]?.name ?? loc}</span>
            <span className="font-display tabular-nums">
              {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
            </span>
            {big !== null ? (
              <span className={`tabular-nums ${big.edge.flag === "model_higher" ? "text-up" : "text-down"}`}>
                {big.edge.flag === "model_higher" ? "▲ +" : "▼ "}
                {big.edge.value.toFixed(2)}
              </span>
            ) : (
              <span className="text-text-3">—</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
