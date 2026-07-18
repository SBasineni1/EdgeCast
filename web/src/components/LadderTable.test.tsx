import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { LadderTable } from "./LadderTable";

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

it("renders rows sorted ascending with range labels", () => {
  render(<LadderTable results={results} consensus={null} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("93° or below");
  expect(rows[1]).toHaveTextContent("96–97°");
  expect(rows[2]).toHaveTextContent("102° or above");
});

it("renders quiet agreement values and colors only flagged edges", () => {
  render(<LadderTable results={results} consensus={null} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows[1]).toHaveTextContent("85%");
  expect(rows[1]).toHaveTextContent("71%");
  const cells = screen.getAllByTestId("edge-cell");
  expect(cells[1].className).toContain("text-down");
  expect(cells[1]).toHaveTextContent("▼ −0.14");
  expect(cells[2].className).toContain("text-up");
  expect(cells[2]).toHaveTextContent("▲ +0.09");
  expect(cells[0]).toHaveTextContent("+0.02");
  expect(cells[0].className).toContain("text-text-3");
  expect(cells[1].className).not.toContain("rounded-full");
});

it("marks the ladder row containing the rounded consensus", () => {
  render(<LadderTable results={results} consensus={96.2} />);
  const marker = screen.getByTestId("consensus-marker");
  expect(marker.closest("[data-testid='ladder-row']")!.textContent).toContain("96–97°");
});

it("omits the marker without consensus", () => {
  render(<LadderTable results={results} consensus={null} />);
  expect(screen.queryByTestId("consensus-marker")).toBeNull();
});

it("settled rows show outcome instead of edge", () => {
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
  render(<LadderTable results={[settled]} consensus={null} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("YES ●");
});

it("settled NO rows show outcome instead of edge", () => {
  const settled = {
    ...row("s", ">=", 90, undefined, undefined, 0.08),
    settlement: {
      outcome: 0 as const,
      observed_value: 85.2,
      brier_market: 0.5,
      brier_model: 0.6,
      brier_diff: 0.1,
    },
  };
  render(<LadderTable results={[settled]} consensus={null} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("NO");
});
