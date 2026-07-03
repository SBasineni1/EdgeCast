import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Aggregate } from "../types";
import { AggregateStrip } from "./AggregateStrip";

const agg: Aggregate = {
  n_scenarios: 6,
  n_settled: 4,
  mean_brier_market: 0.1946,
  mean_brier_model: 0.294722,
  better_calibrated: "market",
};

it("renders counts and dotless brier figures", () => {
  render(<AggregateStrip aggregate={agg} />);
  expect(screen.getByText("6")).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByText(".195")).toBeInTheDocument();
  expect(screen.getByText(".295")).toBeInTheDocument();
});

it.each([
  ["market", "MARKET BETTER CALIBRATED"],
  ["model", "MODEL BETTER CALIBRATED"],
  ["tie", "MARKET AND MODEL TIED"],
] as const)("verdict for %s", (better, text) => {
  render(<AggregateStrip aggregate={{ ...agg, better_calibrated: better }} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent(text);
});

const verification = {
  window_days: 30, model: "gfs_seamless", n_markets: 214, n_days: 29,
  mean_brier_market: 0.091, mean_brier_model: 0.117,
  hit_rate_market: 0.72, hit_rate_model: 0.62,
  better_calibrated: "market" as const,
  by_city: {}, yesterday: {}, kalshi_mismatches: [], verification_failed: [],
};

it("verification variant shows window stats and qualified verdict", () => {
  render(<AggregateStrip aggregate={agg} verification={verification} />);
  expect(screen.getByText("214")).toBeInTheDocument();
  expect(screen.getByText(".091")).toBeInTheDocument();
  expect(screen.getByText("72% / 62%")).toBeInTheDocument();
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "MARKET BETTER CALIBRATED · VERIFIED: LAST 30 DAYS",
  );
});

it("null verification shows awaiting-backfill state", () => {
  render(<AggregateStrip aggregate={agg} verification={null} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING VERIFICATION");
});

it("shows awaiting state when nothing is settled", () => {
  render(
    <AggregateStrip
      aggregate={{
        n_scenarios: 2,
        n_settled: 0,
        mean_brier_market: null,
        mean_brier_model: null,
        better_calibrated: null,
      }}
    />,
  );
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING SETTLEMENTS");
  expect(screen.getAllByText("—")).toHaveLength(2);
});
