import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { CityCard } from "./CityCard";

function row(id: string, comparator: string, t?: number, lo?: number, hi?: number, edge = 0.02): ScenarioResult {
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
    market_prob: 0.85,
    model_prob: 0.71,
    model_prob_raw: 0.71,
    n_members: 31,
    edge: {
      value: edge,
      log_odds_diff: 0.1,
      flag: edge >= 0.05 ? "model_higher" : edge <= -0.05 ? "market_higher" : "agreement",
    },
    settlement: null,
  };
}

const results = [
  row("hi", ">=", 102, undefined, undefined, 0.09),
  row("mid", "between", undefined, 96, 97, -0.14),
  row("lo", "<=", 93, undefined, undefined),
];

const props = {
  location: "AUS",
  cityInfo: { name: "Austin", station: "Camp Mabry", series: "KXHIGHAUS" },
  results,
  yesterday: {
    date: "2026-07-03",
    observed_high: 96,
    source: "ACIS KATT",
    settled_bucket: "96–97°",
    brier_market: 0.054,
    brier_model: 0.112,
  },
  cityStats: {
    n_markets: 31,
    mean_brier_market: 0.08,
    mean_brier_model: 0.1,
    hit_rate_market: 0.75,
    hit_rate_model: 0.64,
  },
  mismatches: [],
};

it("renders rows sorted ascending with range labels", () => {
  render(<CityCard {...props} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("93° or below");
  expect(rows[1]).toHaveTextContent("96–97°");
  expect(rows[2]).toHaveTextContent("102° or above");
});

it("renders percentages and colored edges", () => {
  render(<CityCard {...props} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows[1]).toHaveTextContent("85%");
  expect(rows[1]).toHaveTextContent("71%");
  const cells = screen.getAllByTestId("edge-cell");
  expect(cells[1].className).toContain("text-down");
  expect(cells[1]).toHaveTextContent("▼ -0.14");
  expect(cells[2].className).toContain("text-up");
  expect(cells[2]).toHaveTextContent("▲ +0.09");
  expect(cells[0]).toHaveTextContent("—");
});

it("renders verification footer with winner dot on lower brier", () => {
  render(<CityCard {...props} />);
  const footer = screen.getByTestId("verification-footer");
  expect(footer).toHaveTextContent("OBSERVED 96°F");
  expect(footer).toHaveTextContent("SETTLED 96–97°");
  expect(footer).toHaveTextContent("BRIER MKT .080 ●");
  expect(footer).toHaveTextContent("HIT 75% / 64%");
});

it("renders unverified state without yesterday data", () => {
  render(<CityCard {...props} yesterday={undefined} cityStats={undefined} />);
  expect(screen.getByTestId("verification-footer")).toHaveTextContent("UNVERIFIED");
});

it("renders red mismatch warning", () => {
  render(
    <CityCard
      {...props}
      mismatches={[{ market_id: "X", kalshi_result: "yes", edgecast_outcome: 0 }]}
    />,
  );
  const warn = screen.getByTestId("mismatch-warning");
  expect(warn.className).toContain("text-down");
  expect(warn).toHaveTextContent("KALSHI SETTLED YES — EDGECAST COMPUTES NO");
});

it("settled fixture rows show outcome instead of edge", () => {
  const settled = {
    ...row("s", ">=", 90, undefined, undefined, 0.08),
    settlement: {
      outcome: 1 as const,
      observed_value: 93.1,
      brier_market: 0.078,
      brier_model: 0.04,
      brier_diff: -0.038,
    },
  };
  render(<CityCard {...props} results={[settled]} yesterday={undefined} cityStats={undefined} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("YES ●");
});
