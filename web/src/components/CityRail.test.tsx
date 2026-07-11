import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ScenarioResult } from "../types";
import { CityRail } from "./CityRail";

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
  ["NYC", [row("n1", "NYC", 0.09), row("n2", "NYC", -0.14)]],
];

const cities = {
  NYC: { name: "New York", station: "Central Park", series: "KXHIGHNY" },
  CHI: { name: "Chicago", station: "Midway", series: "KXHIGHCHI" },
};

const modelHighs = {
  NYC: { consensus: 91.8 },
  CHI: { consensus: 88.5 },
};

it("renders one card per city with consensus temp, selected pressed", () => {
  render(
    <CityRail groups={groups} cities={cities} modelHighs={modelHighs} selected="CHI" onSelect={vi.fn()} />,
  );
  const cards = screen.getAllByTestId("rail-city");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("Chicago");
  expect(cards[0]).toHaveTextContent("88.5°");
  expect(cards[0]).toHaveAttribute("aria-pressed", "true");
  expect(cards[1]).toHaveAttribute("aria-pressed", "false");
});

it("selects a city on click", () => {
  const onSelect = vi.fn();
  render(
    <CityRail groups={groups} cities={cities} modelHighs={modelHighs} selected="CHI" onSelect={onSelect} />,
  );
  fireEvent.click(screen.getAllByTestId("rail-city")[1]);
  expect(onSelect).toHaveBeenCalledWith("NYC");
});

it("lists flagged edges sorted by magnitude and jumps on click", () => {
  const onSelect = vi.fn();
  render(
    <CityRail groups={groups} cities={cities} modelHighs={modelHighs} selected="CHI" onSelect={onSelect} />,
  );
  const edges = screen.getAllByTestId("top-edge");
  expect(edges).toHaveLength(2); // CHI's 0.02 is agreement — excluded
  expect(edges[0]).toHaveTextContent("▼ -0.14");
  expect(edges[1]).toHaveTextContent("▲ +0.09");
  fireEvent.click(edges[0]);
  expect(onSelect).toHaveBeenCalledWith("NYC");
});
