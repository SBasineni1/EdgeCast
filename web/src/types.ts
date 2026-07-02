export interface MarketMeta {
  question: string;
  location: string;
  variable: string;
  comparator: string;
  threshold: number;
  event_date: string;
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

export interface AnalysisOutput {
  schema_version: string;
  generated_at: string;
  results: ScenarioResult[];
  aggregate: Aggregate;
}
