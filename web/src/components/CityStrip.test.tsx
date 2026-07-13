import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ScenarioResult } from "../types";
import { CityStrip } from "./CityStrip";

function row(id: string, location: string, edge: number): ScenarioResult {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location,
      variable: "high_temp_f",
      comparator: ">=",
      threshold: 90,
      event_date: "2026-07-04",
    },
    market_prob: 0.5,
    model_prob: 0.5 + edge,
    model_prob_raw: 0.5 + edge,
    n_members: 3,
    edge: {
      value: edge,
      log_odds_diff: 0,
      flag: edge >= 0.05 ? "model_higher" : edge <= -0.05 ? "market_higher" : "agreement",
    },
    settlement: null,
  };
}

const groups: [string, ScenarioResult[]][] = [
  ["CHI", [row("c1", "CHI", 0.02)]],
  ["NYC", [row("n1", "NYC", -0.14)]],
];

const cities = {
  NYC: { name: "New York", station: "Central Park", series: "KXHIGHNY" },
  CHI: { name: "Chicago", station: "Midway", series: "KXHIGHCHI" },
};

const modelHighs = {
  NYC: { consensus: 91.8 },
  CHI: { consensus: 88.5 },
};

it("renders one chip per city and marks the selected city pressed", () => {
  render(
    <CityStrip
      groups={groups}
      cities={cities}
      modelHighs={modelHighs}
      selected="CHI"
      onSelect={vi.fn()}
    />,
  );

  const chips = screen.getAllByTestId("city-chip");
  expect(chips).toHaveLength(2);
  expect(chips[0]).toHaveTextContent("Chicago");
  expect(chips[0]).toHaveTextContent("88.5°");
  expect(chips[0]).toHaveAttribute("aria-pressed", "true");
  expect(chips[1]).toHaveAttribute("aria-pressed", "false");
});

it("selects a city on click", () => {
  const onSelect = vi.fn();
  render(
    <CityStrip
      groups={groups}
      cities={cities}
      modelHighs={modelHighs}
      selected="CHI"
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getAllByTestId("city-chip")[1]);
  expect(onSelect).toHaveBeenCalledWith("NYC");
});
