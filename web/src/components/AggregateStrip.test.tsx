import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Aggregate, ModelGrades } from "../types";
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

const modelGrades: ModelGrades = {
  window_days: 30,
  lead: "day_ahead",
  overall: {
    consensus: { n_days: 28, mae: 1.5, bias: 0.1, bucket_hit_rate: 0.41 },
    ncep_nbm_conus: { n_days: 28, mae: 2.1, bias: -0.9, bucket_hit_rate: 0.31 },
    gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.26 },
    gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.33 },
  },
  by_city: {},
};

it("renders per-model grades with closest-model verdict", () => {
  render(<AggregateStrip aggregate={agg} modelGrades={modelGrades} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "CONSENSUS CLOSEST · DAY-AHEAD · LAST 30 DAYS",
  );
  expect(screen.getByText("1.5°")).toBeInTheDocument();
  expect(screen.getByText("CONSENSUS RIGHT BUCKET")).toBeInTheDocument();
  expect(screen.getByText("41%")).toBeInTheDocument();
});

it("breaks MAE ties by bucket hit rate", () => {
  const tied: ModelGrades = {
    ...modelGrades,
    overall: {
      gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.4 },
      gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.3 },
    },
  };
  render(<AggregateStrip aggregate={agg} modelGrades={tied} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("HRRR CLOSEST");
});

it("null model grades show awaiting-backfill state", () => {
  render(<AggregateStrip aggregate={agg} modelGrades={null} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING MODEL GRADES");
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
