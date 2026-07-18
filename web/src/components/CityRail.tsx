import type { CityInfo, ScenarioResult } from "../types";
import { formatSigned, formatTemperature, rangeLabel } from "../format";

function flagged(results: ScenarioResult[]): ScenarioResult[] {
  return results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
}

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const rows = results.filter((r) => r.settlement === null);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

function EdgeBadge({ r }: { r: ScenarioResult }) {
  if (r.edge.flag === "agreement") {
    return (
      <span className="data-nums text-[11px] text-text-3">
        {formatSigned(r.edge.value)}
      </span>
    );
  }
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`data-nums text-[11px] font-medium ${
        up ? "text-up" : "text-down"
      }`}
    >
      {up ? "▲ " : "▼ "}
      {formatSigned(r.edge.value)}
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
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-8 overflow-y-auto border-l border-hairline px-5 py-7 xl:flex">
      <section>
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-2 border-b border-hairline px-2 pb-2 text-[10px] font-medium uppercase tracking-wide text-text-3">
          <span>City</span>
          <span className="text-right">High</span>
          <span className="text-right">Edge</span>
        </div>
        <ul className="flex flex-col">
          {groups.map(([loc, results]) => {
            const consensus = modelHighs?.[loc]?.consensus ?? null;
            const big = biggestEdge(results);
            const active = loc === selected;
            return (
              <li key={loc} className="border-b border-hairline last:border-b-0" data-anim="rail-item">
                <button
                  onClick={() => onSelect(loc)}
                  aria-pressed={active}
                  data-testid="rail-city"
                  className={`grid w-full grid-cols-[minmax(0,1fr)_4rem_4.5rem] items-center gap-2 border-l-2 px-2 py-3 text-left transition-colors duration-150 ${
                    active ? "border-l-accent bg-panel-2" : "border-l-transparent hover:bg-panel-2/60"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{cities[loc]?.name ?? loc}</span>
                    <span className="block truncate text-[11px] text-text-3">{cities[loc]?.station ?? ""}</span>
                  </span>
                  <span className="data-nums text-right text-base font-medium">
                    {consensus !== null ? formatTemperature(consensus) : "—"}
                  </span>
                  <span className="justify-self-end">
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
