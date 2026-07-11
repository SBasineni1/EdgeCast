import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { LadderChart } from "./LadderChart";

function row(id: string, comparator: string, t?: number, lo?: number, hi?: number, market = 0.5, model = 0.5): ScenarioResult {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location: "AUS",
      variable: "high_temp_f",
      comparator,
      threshold: t,
      threshold_low: lo,
      threshold_high: hi,
      event_date: "2026-07-04",
    },
    market_prob: market,
    model_prob: model,
    model_prob_raw: model,
    n_members: 3,
    edge: { value: model - market, log_odds_diff: 0, flag: "agreement" },
    settlement: null,
  };
}

const results = [
  row("lo", "<=", 93, undefined, undefined, 0.1, 0.05),
  row("mid", "between", undefined, 96, 97, 0.6, 0.72),
  row("hi", ">=", 102, undefined, undefined, 0.3, 0.23),
];

it("renders two lines, pills with end values, and bucket labels", () => {
  render(<LadderChart results={results} consensus={null} />);
  expect(screen.getByTestId("ladder-chart")).toBeInTheDocument();
  expect(screen.getByTestId("market-line")).toBeInTheDocument();
  expect(screen.getByTestId("model-line")).toBeInTheDocument();
  // pills show the last (highest) bucket's values
  expect(screen.getByText("MARKET 30%")).toBeInTheDocument();
  expect(screen.getByText("MODEL 23%")).toBeInTheDocument();
  // compact x-axis labels
  expect(screen.getByText("≤93")).toBeInTheDocument();
  expect(screen.getByText("96–97")).toBeInTheDocument();
  expect(screen.getByText("≥102")).toBeInTheDocument();
});

it("draws a consensus marker line at the marked bucket", () => {
  render(<LadderChart results={results} consensus={96.2} />);
  expect(screen.getByTestId("chart-consensus-line")).toBeInTheDocument();
});

it("omits the consensus line without consensus", () => {
  render(<LadderChart results={results} consensus={null} />);
  expect(screen.queryByTestId("chart-consensus-line")).toBeNull();
});

it("renders nothing with fewer than two buckets", () => {
  const { container } = render(<LadderChart results={[results[0]]} consensus={null} />);
  expect(container.firstChild).toBeNull();
});

it("shows a hover tooltip with the bucket's market and model percentages", () => {
  render(<LadderChart results={results} consensus={null} />);
  const zones = screen.getAllByTestId("chart-hover-zone");
  expect(zones).toHaveLength(3);
  fireEvent.mouseOver(zones[1]);
  expect(screen.getByTestId("chart-hover-tip")).toBeInTheDocument();
  expect(screen.getByText("MARKET 60%")).toBeInTheDocument();
  expect(screen.getByText("MODEL 72%")).toBeInTheDocument();
  expect(screen.getByTestId("chart-hover-band")).toBeInTheDocument();
});

it("clears the tooltip on mouse leave", () => {
  render(<LadderChart results={results} consensus={null} />);
  const zones = screen.getAllByTestId("chart-hover-zone");
  fireEvent.mouseOver(zones[1]);
  fireEvent.mouseLeave(zones[1].parentElement!);
  expect(screen.queryByTestId("chart-hover-tip")).toBeNull();
});
