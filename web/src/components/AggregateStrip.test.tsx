import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ModelGrades } from "../types";
import { AggregateStrip } from "./AggregateStrip";

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
  render(<AggregateStrip modelGrades={modelGrades} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "CONSENSUS CLOSEST · DAY-FORWARD · LAST 30 DAYS",
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
  render(<AggregateStrip modelGrades={tied} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("HRRR CLOSEST");
});

it("null model grades show awaiting-backfill state", () => {
  render(<AggregateStrip modelGrades={null} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING MODEL GRADES");
});
