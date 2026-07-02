import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const OUTPUT = {
  schema_version: "1.1",
  generated_at: "2026-07-02T18:00:00+00:00",
  results: [
    {
      scenario_id: "s1",
      market: {
        question: "NYC high temp >= 90F on 2026-07-05?",
        location: "NYC",
        variable: "high_temp_f",
        comparator: ">=",
        threshold: 90,
        event_date: "2026-07-05",
      },
      market_prob: 0.72,
      model_prob: 0.8,
      model_prob_raw: 0.8,
      n_members: 30,
      edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
      settlement: null,
    },
  ],
  aggregate: {
    n_scenarios: 1,
    n_settled: 0,
    mean_brier_market: null,
    mean_brier_model: null,
    better_calibrated: null,
  },
};

it("shows SIGNAL LOST when the API is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  render(<App />);
  expect(await screen.findByText("SIGNAL LOST")).toBeInTheDocument();
});

it("shows empty state when no scenario files exist", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(200, { files: [] })),
  );
  render(<App />);
  expect(await screen.findByText(/NO SCENARIO FILES/)).toBeInTheDocument();
});

it("loads files, auto-analyzes the first, renders strip and cards", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/scenario-files"
      ? fakeResponse(200, { files: ["sample.json"] })
      : fakeResponse(200, OUTPUT),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  expect(await screen.findByTestId("verdict")).toHaveTextContent(
    "AWAITING SETTLEMENTS",
  );
  expect(
    screen.getByText("NYC high temp >= 90F on 2026-07-05?"),
  ).toBeInTheDocument();
});

it("shows INPUT ERROR strip on 422 detail", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/scenario-files"
      ? fakeResponse(200, { files: ["bad.json"] })
      : fakeResponse(422, { detail: "scenario 's1': field 'yes_price' bad" }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  expect(await screen.findByText(/INPUT ERROR/)).toBeInTheDocument();
  expect(screen.getByText(/yes_price/)).toBeInTheDocument();
});
