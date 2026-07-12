import type { CityInfo, ScenarioResult } from "../types";
import { rangeLabel } from "../format";

function flagged(results: ScenarioResult[]): ScenarioResult[] {
  return results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
}

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const rows = flagged(results);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

function EdgeBadge({ r }: { r: ScenarioResult }) {
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
        up ? "bg-up/10 text-up" : "bg-down/10 text-down"
      }`}
    >
      {up ? "▲ +" : "▼ "}
      {r.edge.value.toFixed(2)}
    </span>
  );
}

interface CityRailProps {
  groups: [string, ScenarioResult[]][];
  cities: Record<string, CityInfo>;
  modelHighs?: Record<string, Record<string, number | null>>;
  selected: string | null;
  onSelect: (location: string) => void;
}

export function CityRail({ groups, cities, modelHighs, selected, onSelect }: CityRailProps) {
  const topEdges = groups
    .flatMap(([loc, results]) => flagged(results).map((r) => ({ loc, r })))
    .sort((a, b) => Math.abs(b.r.edge.value) - Math.abs(a.r.edge.value))
    .slice(0, 6);
  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col gap-8 overflow-y-auto border-l border-hairline px-5 py-7">
      <section>
        <p className="pb-3 text-xs font-medium text-text-3">Cities</p>
        <ul className="flex flex-col gap-2">
          {groups.map(([loc, results]) => {
            const consensus = modelHighs?.[loc]?.consensus ?? null;
            const big = biggestEdge(results);
            const active = loc === selected;
            return (
              <li key={loc} data-anim="rail-item">
                <button
                  onClick={() => onSelect(loc)}
                  aria-pressed={active}
                  data-testid="rail-city"
                  className={`flex w-full items-center justify-between gap-2 rounded-2xl border p-4 text-left shadow-sm transition-colors duration-150 ${
                    active ? "border-lime bg-panel ring-1 ring-lime/30" : "border-hairline bg-panel hover:bg-panel-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{cities[loc]?.name ?? loc}</span>
                    <span className="block truncate text-[11px] text-text-3">{cities[loc]?.station ?? ""}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-display text-lg font-medium tabular-nums">
                      {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
                    </span>
                    {big !== null ? <EdgeBadge r={big} /> : <span className="text-[11px] text-text-3">—</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {topEdges.length > 0 && (
        <section>
          <p className="pb-3 text-xs font-medium text-text-3">Top edges</p>
          <ul className="flex flex-col">
            {topEdges.map(({ loc, r }) => (
              <li key={r.scenario_id} data-anim="rail-item">
                <button
                  onClick={() => onSelect(loc)}
                  data-testid="top-edge"
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-panel-2"
                >
                  <span className="min-w-0">
                    <span className="block text-xs">{cities[loc]?.name ?? loc}</span>
                    <span className="block text-[11px] text-text-3">{rangeLabel(r.market)}</span>
                  </span>
                  <EdgeBadge r={r} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
