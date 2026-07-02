import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { MarketCard } from "./MarketCard";

const base: ScenarioResult = {
  scenario_id: "s1",
  market: {
    question: "NYC high temp >= 90F on 2026-07-05?",
    location: "NYC",
    variable: "high_temp_f",
    comparator: ">=",
    threshold: 90,
    event_date: "2026-07-05",
  },
  market_prob: 0.72,
  model_prob: 0.8,
  model_prob_raw: 0.8,
  n_members: 30,
  edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
  settlement: {
    outcome: 1,
    observed_value: 93.1,
    brier_market: 0.0784,
    brier_model: 0.04,
    brier_diff: -0.0384,
  },
};

it("shows question and formatted date", () => {
  render(<MarketCard result={base} />);
  expect(screen.getByText("NYC high temp >= 90F on 2026-07-05?")).toBeInTheDocument();
  expect(screen.getByText("JUL 05")).toBeInTheDocument();
});

it("flags model_higher in signal style with arrow and signed value", () => {
  render(<MarketCard result={base} />);
  const flag = screen.getByTestId("edge-flag");
  expect(flag).toHaveTextContent("▲ +0.08 MODEL HIGHER");
});

it("flags market_higher with down arrow and minus sign", () => {
  render(
    <MarketCard
      result={{
        ...base,
        edge: { value: -0.15, log_odds_diff: -0.6, flag: "market_higher" },
      }}
    />,
  );
  expect(screen.getByTestId("edge-flag")).toHaveTextContent("▼ -0.15 MARKET HIGHER");
});

it("shows dimmed agreement instead of a flag", () => {
  render(
    <MarketCard
      result={{ ...base, edge: { value: 0.03, log_odds_diff: 0.1, flag: "agreement" } }}
    />,
  );
  expect(screen.queryByTestId("edge-flag")).toBeNull();
  expect(screen.getByTestId("edge-agreement")).toHaveTextContent("AGREEMENT");
});

it("settled card shows outcome, observation and winner dot on lower brier", () => {
  render(<MarketCard result={base} />);
  expect(screen.getByText(/SETTLED YES/)).toBeInTheDocument();
  expect(screen.getByText(/OBSERVED 93.1/)).toBeInTheDocument();
  expect(screen.getByText(/MDL 0.040 ●/)).toBeInTheDocument();
});

it("unsettled card shows awaiting state", () => {
  render(<MarketCard result={{ ...base, settlement: null }} />);
  expect(screen.getByText("AWAITING OBSERVATION")).toBeInTheDocument();
});

it("shows clamp annotation only when raw differs", () => {
  const { rerender } = render(<MarketCard result={base} />);
  expect(screen.queryByText(/raw/)).toBeNull();
  rerender(
    <MarketCard result={{ ...base, model_prob_raw: 1.0, model_prob: 0.967742 }} />,
  );
  expect(screen.getByText("raw 1.00 → 0.97")).toBeInTheDocument();
});
