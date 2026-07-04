import type { CityInfo, KalshiMismatch, ModelGradeStats, ScenarioResult } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

const SOURCE_ORDER = MODEL_ORDER.filter((m) => m !== "consensus");

function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

function rangeLabel(market: ScenarioResult["market"]): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}°`;
  if (market.comparator === ">=") return `${market.threshold}° or above`;
  if (market.comparator === "<=") return `${market.threshold}° or below`;
  if (market.comparator === ">") return `above ${market.threshold}°`;
  return `below ${market.threshold}°`;
}

function sortKey(r: ScenarioResult): number {
  const m = r.market;
  if (m.comparator === "between") return m.threshold_low ?? 0;
  if (m.comparator === "<=" || m.comparator === "<") return (m.threshold ?? 0) - 1000;
  return m.threshold ?? 0;
}

function bucketContains(market: ScenarioResult["market"], t: number): boolean {
  if (market.comparator === "between")
    return (market.threshold_low ?? NaN) <= t && t <= (market.threshold_high ?? NaN);
  const thr = market.threshold ?? NaN;
  if (market.comparator === ">") return t > thr;
  if (market.comparator === ">=") return t >= thr;
  if (market.comparator === "<") return t < thr;
  return t <= thr;
}

function biasWords(bias: number): string {
  if (Math.abs(bias) < 0.05) return "NO LEAN";
  const sign = bias > 0 ? "+" : "−";
  return `RUNS ${sign}${Math.abs(bias).toFixed(1)}° ${bias > 0 ? "WARM" : "COOL"}`;
}

function gradeLine(model: string, g: ModelGradeStats): string {
  const hit = g.bucket_hit_rate === null
    ? ""
    : ` · RIGHT BUCKET ${Math.round(g.bucket_hit_rate * 100)}%`;
  return `${MODEL_NAMES[model] ?? model.toUpperCase()} · OFF BY ${g.mae.toFixed(1)}°F${hit} · ${biasWords(g.bias)}`;
}

function ProbCell({ value, tone }: { value: number; tone: "text-2" | "text-3" }) {
  return (
    <div className="w-14">
      <span className="tabular-nums">{Math.round(value * 100)}%</span>
      <div className="mt-0.5 h-0.5 bg-hairline">
        <div
          className={tone === "text-2" ? "h-full bg-text-2" : "h-full bg-text-3"}
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, transition: "width 200ms ease-out" }}
        />
      </div>
    </div>
  );
}

function EdgeCell({ r }: { r: ScenarioResult }) {
  if (r.settlement !== null) {
    const won = r.settlement.outcome === 1;
    return (
      <span className="w-20 text-right tabular-nums" data-testid="edge-cell">
        {won ? "YES ●" : "NO"}
      </span>
    );
  }
  const { edge } = r;
  if (edge.flag === "agreement") {
    return (
      <span className="w-20 text-right text-text-3" data-testid="edge-cell">
        —
      </span>
    );
  }
  const up = edge.flag === "model_higher";
  return (
    <span
      className={`w-20 text-right tabular-nums ${up ? "text-up" : "text-down"}`}
      style={{
        textShadow: up
          ? "0 0 8px rgba(46, 204, 113, 0.45)"
          : "0 0 8px rgba(255, 77, 77, 0.45)",
      }}
      title={up ? "model higher" : "market higher"}
      data-testid="edge-cell"
    >
      {up ? "▲ +" : "▼ "}
      {edge.value.toFixed(2)}
    </span>
  );
}

interface CityCardProps {
  location: string;
  cityInfo?: CityInfo;
  results: ScenarioResult[];
  modelHighs?: Record<string, number | null>;
  grades?: Record<string, ModelGradeStats>;
  mismatches: KalshiMismatch[];
}

export function CityCard({ location, cityInfo, results, modelHighs, grades, mismatches }: CityCardProps) {
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const eventDate = sorted[0]?.market.event_date;
  const consensus = modelHighs?.consensus ?? null;
  const consensusInt = consensus !== null ? Math.floor(consensus + 0.5) : null;
  const markedId =
    consensusInt !== null
      ? sorted.find((r) => bucketContains(r.market, consensusInt))?.scenario_id
      : undefined;
  const sourceHighs = SOURCE_ORDER
    .filter((m) => modelHighs?.[m] != null)
    .map((m) => `${MODEL_NAMES[m]} ${(modelHighs![m] as number).toFixed(1)}`)
    .join(" · ");
  const gradeModels = MODEL_ORDER.filter((m) => grades?.[m] !== undefined);
  return (
    <article className="border border-hairline bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2 pb-2">
        <span className="text-xs font-bold tracking-[0.25em]">{location} · HIGH TEMP</span>
        <span className="shrink-0 text-xs text-text-3">
          {cityInfo ? `${cityInfo.station.toUpperCase()} · ` : ""}
          {eventDate ? formatDate(eventDate) : ""}
        </span>
      </header>
      {consensus !== null && (
        <div className="flex items-baseline justify-between gap-2 pb-2 text-xs">
          <span className="font-bold tabular-nums">CONSENSUS {consensus.toFixed(1)}°</span>
          {sourceHighs && <span className="tabular-nums text-text-3">{sourceHighs}</span>}
        </div>
      )}
      <div className="flex justify-between border-b border-hairline pb-1 text-[10px] tracking-[0.2em] text-text-3">
        <span>RANGE</span>
        <span className="flex gap-6">
          <span className="w-14">MARKET</span>
          <span className="w-14">MODEL</span>
          <span className="w-20 text-right">EDGE</span>
        </span>
      </div>
      <ul>
        {sorted.map((r) => (
          <li
            key={r.scenario_id}
            className="flex items-center justify-between border-b border-hairline py-2 text-sm"
            data-testid="ladder-row"
          >
            <span className="text-xs">
              {r.scenario_id === markedId && (
                <span className="text-text-2" title="consensus lands here" data-testid="consensus-marker">
                  ▸{" "}
                </span>
              )}
              {rangeLabel(r.market)}
            </span>
            <span className="flex items-center gap-6">
              <ProbCell value={r.market_prob} tone="text-2" />
              <ProbCell value={r.model_prob} tone="text-3" />
              <EdgeCell r={r} />
            </span>
          </li>
        ))}
      </ul>
      <footer className="pt-2 text-xs text-text-2" data-testid="verification-footer">
        {gradeModels.length > 0 ? (
          gradeModels.map((m) => (
            <p key={m} className={m === "consensus" ? "" : "text-text-3"}>
              {gradeLine(m, grades![m])}
            </p>
          ))
        ) : (
          <p className="text-text-3">MODELS UNGRADED — run: uv run edgecast backfill</p>
        )}
        {mismatches.map((m) => (
          <p key={m.market_id} className="text-down" data-testid="mismatch-warning">
            ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
            {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
          </p>
        ))}
      </footer>
    </article>
  );
}
