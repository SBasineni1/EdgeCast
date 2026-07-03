export interface MarketMeta {
  question: string;
  location: string;
  variable: string;
  comparator: string;
  threshold?: number;
  threshold_low?: number;
  threshold_high?: number;
  event_date: string;
}

export interface CityInfo {
  name: string;
  station: string;
  series: string;
}

export interface LiveInfo {
  fetched_at: string;
  cities_ok: string[];
  cities_failed: { city: string; reason: string }[];
  quotes_age_seconds: number;
  ensembles_age_seconds: number;
  cities: Record<string, CityInfo>;
}

export interface EdgeMetrics {
  value: number;
  log_odds_diff: number;
  flag: "model_higher" | "market_higher" | "agreement";
}

export interface SettlementResult {
  outcome: 0 | 1;
  observed_value: number;
  brier_market: number;
  brier_model: number;
  brier_diff: number;
}

export interface ScenarioResult {
  scenario_id: string;
  market: MarketMeta;
  market_prob: number;
  model_prob: number;
  model_prob_raw: number;
  n_members: number;
  edge: EdgeMetrics;
  settlement: SettlementResult | null;
}

export interface Aggregate {
  n_scenarios: number;
  n_settled: number;
  mean_brier_market: number | null;
  mean_brier_model: number | null;
  better_calibrated: "model" | "market" | "tie" | null;
}

export interface CityWindowStats {
  n_markets: number;
  mean_brier_market: number;
  mean_brier_model: number;
  hit_rate_market: number;
  hit_rate_model: number;
}

export interface YesterdayInfo {
  date: string;
  observed_high: number;
  source: string;
  settled_bucket: string | null;
  brier_market: number;
  brier_model: number;
}

export interface KalshiMismatch {
  market_id: string;
  kalshi_result: string;
  edgecast_outcome: number;
}

export interface VerificationInfo {
  window_days: number;
  model: string;
  n_markets: number;
  n_days: number;
  mean_brier_market: number;
  mean_brier_model: number;
  hit_rate_market: number;
  hit_rate_model: number;
  better_calibrated: "market" | "model" | "tie";
  by_city: Record<string, CityWindowStats>;
  yesterday: Record<string, YesterdayInfo>;
  kalshi_mismatches: KalshiMismatch[];
  verification_failed: { city: string; stage: string; reason: string }[];
}

export interface AnalysisOutput {
  schema_version: string;
  generated_at: string;
  results: ScenarioResult[];
  aggregate: Aggregate;
  live?: LiveInfo;
  verification?: VerificationInfo | null;
}
