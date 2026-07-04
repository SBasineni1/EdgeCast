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
  model_highs: Record<string, Record<string, number | null>>;
  consensus_sigma: Record<string, number | null>;
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

export interface ModelGradeStats {
  n_days: number;
  mae: number;
  bias: number;
  bucket_hit_rate: number | null;
}

export interface ModelGrades {
  window_days: number;
  lead: string;
  overall: Record<string, ModelGradeStats>;
  by_city: Record<string, Record<string, ModelGradeStats>>;
}

export const MODEL_NAMES: Record<string, string> = {
  consensus: "CONSENSUS",
  ncep_nbm_conus: "NBM",
  gfs_hrrr: "HRRR",
  gfs_global: "GFS",
};

export const MODEL_ORDER = ["consensus", "ncep_nbm_conus", "gfs_hrrr", "gfs_global"];

export interface KalshiMismatch {
  market_id: string;
  kalshi_result: string;
  edgecast_outcome: number;
}

export interface VerificationInfo {
  window_days: number;
  n_markets: number;
  n_days: number;
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
  model_grades?: ModelGrades | null;
}
