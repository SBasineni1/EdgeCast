import { render, screen, fireEvent } from "@testing-library/react";
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
    n_members: 3,
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

const grades = {
  consensus: { n_days: 28, mae: 1.5, bias: 0.1, bucket_hit_rate: 0.41 },
  ncep_nbm_conus: { n_days: 28, mae: 2.1, bias: -0.9, bucket_hit_rate: 0.31 },
  gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.02, bucket_hit_rate: 0.26 },
  gfs_global: { n_days: 28, mae: 2.16, bias: 0.79, bucket_hit_rate: null },
};

const modelHighs = { ncep_nbm_conus: 96.4, gfs_hrrr: 98.0, gfs_global: 102.2, consensus: 96.2 };

const props = {
  location: "AUS",
  cityInfo: { name: "Austin", station: "Bergstrom Intl", series: "KXHIGHAUS" },
  results,
  modelHighs,
  grades,
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

it("shows consensus high and per-model grade lines", () => {
  render(<CityCard {...props} />);
  expect(screen.getByText(/CONSENSUS 96\.2°/)).toBeInTheDocument();
  expect(screen.getByText(/NBM 96\.4 · HRRR 98\.0 · GFS 102\.2/)).toBeInTheDocument();
  const footer = screen.getByTestId("verification-footer");
  expect(footer.textContent).toContain("CONSENSUS · OFF BY 1.5°F · RIGHT BUCKET 41% · RUNS +0.1° WARM");
  expect(footer.textContent).toContain("NBM · OFF BY 2.1°F · RIGHT BUCKET 31% · RUNS −0.9° COOL");
  expect(footer.textContent).toContain("HRRR · OFF BY 2.2°F · RIGHT BUCKET 26% · NO LEAN");
  expect(footer.textContent).toContain("GFS · OFF BY 2.2°F · RUNS +0.8° WARM");
});

it("marks the ladder row containing the rounded consensus", () => {
  // consensus 96.2 -> floor(96.7) = 96 -> the 96–97° bucket carries the marker
  render(<CityCard {...props} />);
  const marker = screen.getByTestId("consensus-marker");
  expect(marker.closest("[data-testid='ladder-row']")!.textContent).toContain("96–97°");
});

it("model skill panel is collapsed by default and toggles", () => {
  render(<CityCard {...props} />);
  const toggle = screen.getByTestId("skill-toggle");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

it("renders ungraded state without model data", () => {
  render(<CityCard {...props} modelHighs={undefined} grades={undefined} />);
  expect(screen.getByTestId("verification-footer")).toHaveTextContent("MODELS UNGRADED");
  expect(screen.queryByTestId("consensus-marker")).toBeNull();
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
  render(<CityCard {...props} results={[settled]} modelHighs={undefined} grades={undefined} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("YES ●");
});
