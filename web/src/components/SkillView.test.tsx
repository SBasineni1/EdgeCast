import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ModelGrades } from "../types";
import { SkillView } from "./SkillView";

const cities = { NYC: { name: "New York", station: "Central Park", series: "KXHIGHNY" } };

const modelGrades: ModelGrades = {
  window_days: 30,
  lead: "day_ahead",
  overall: {
    consensus: { n_days: 28, mae: 1.5, bias: 0.1, bucket_hit_rate: 0.41 },
    ncep_nbm_conus: { n_days: 28, mae: 2.1, bias: -0.9, bucket_hit_rate: 0.31 },
    gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.26 },
    gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.33 },
  },
  by_city: {
    NYC: { consensus: { n_days: 28, mae: 1.4, bias: 0.2, bucket_hit_rate: 0.45 } },
  },
};

it("renders per-model grades with closest-model verdict and by-city lines", () => {
  render(<SkillView modelGrades={modelGrades} cities={cities} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "Consensus closest · day-ahead · last 30 days",
  );
  expect(screen.getByText("1.5°")).toBeInTheDocument();
  expect(screen.getByText("Consensus right bucket")).toBeInTheDocument();
  expect(screen.getByText("41%")).toBeInTheDocument();
  const city = screen.getByTestId("skill-city");
  expect(city).toHaveTextContent("New York");
  expect(city).toHaveTextContent("Consensus");
  expect(city).toHaveTextContent("1.4°");
  expect(city).toHaveTextContent("45%");
  expect(city).toHaveTextContent("+0.2° warm");
});

it("breaks MAE ties by bucket hit rate", () => {
  const tied: ModelGrades = {
    ...modelGrades,
    by_city: {},
    overall: {
      gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.4 },
      gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.3 },
    },
  };
  render(<SkillView modelGrades={tied} cities={{}} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("HRRR closest");
});

it("null model grades show awaiting-backfill state", () => {
  render(<SkillView modelGrades={null} cities={{}} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("Awaiting model grades");
});
