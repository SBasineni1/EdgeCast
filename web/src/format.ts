import type { MarketMeta, ModelGrades, ModelGradeStats, ScenarioResult } from "./types";
import { MODEL_NAMES } from "./types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

export function rangeLabel(market: MarketMeta): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}°`;
  if (market.comparator === ">=") return `${market.threshold}° or above`;
  if (market.comparator === "<=") return `${market.threshold}° or below`;
  if (market.comparator === ">") return `above ${market.threshold}°`;
  return `below ${market.threshold}°`;
}

export function shortRangeLabel(market: MarketMeta): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}`;
  if (market.comparator === ">=") return `≥${market.threshold}`;
  if (market.comparator === "<=") return `≤${market.threshold}`;
  if (market.comparator === ">") return `>${market.threshold}`;
  return `<${market.threshold}`;
}

export function sortKey(r: ScenarioResult): number {
  const m = r.market;
  if (m.comparator === "between") return m.threshold_low ?? 0;
  if (m.comparator === "<=" || m.comparator === "<") return (m.threshold ?? 0) - 1000;
  return m.threshold ?? 0;
}

export function bucketContains(market: MarketMeta, t: number): boolean {
  if (market.comparator === "between")
    return (market.threshold_low ?? NaN) <= t && t <= (market.threshold_high ?? NaN);
  const thr = market.threshold ?? NaN;
  if (market.comparator === ">") return t > thr;
  if (market.comparator === ">=") return t >= thr;
  if (market.comparator === "<") return t < thr;
  return t <= thr;
}

export function markedScenarioId(
  results: ScenarioResult[],
  consensus: number | null,
): string | undefined {
  if (consensus === null) return undefined;
  const t = Math.floor(consensus + 0.5);
  return results.find((r) => bucketContains(r.market, t))?.scenario_id;
}

export function biasWords(bias: number): string {
  if (Math.abs(bias) < 0.05) return "NO LEAN";
  const sign = bias > 0 ? "+" : "−";
  return `RUNS ${sign}${Math.abs(bias).toFixed(1)}° ${bias > 0 ? "WARM" : "COOL"}`;
}

export function gradeLine(model: string, g: ModelGradeStats): string {
  const hit = g.bucket_hit_rate === null
    ? ""
    : ` · RIGHT BUCKET ${Math.round(g.bucket_hit_rate * 100)}%`;
  return `${MODEL_NAMES[model] ?? model.toUpperCase()} · OFF BY ${g.mae.toFixed(1)}°F${hit} · ${biasWords(g.bias)}`;
}

export function closestModel(grades: ModelGrades): string | null {
  const entries = Object.entries(grades.overall);
  if (entries.length === 0) return null;
  const hit = (r: number | null) => r ?? -1;
  entries.sort(
    ([, a], [, b]) => a.mae - b.mae || hit(b.bucket_hit_rate) - hit(a.bucket_hit_rate),
  );
  const [name, best] = entries[0];
  const rival = entries[1]?.[1];
  if (rival && rival.mae === best.mae && hit(rival.bucket_hit_rate) === hit(best.bucket_hit_rate)) {
    return null;
  }
  return name;
}
