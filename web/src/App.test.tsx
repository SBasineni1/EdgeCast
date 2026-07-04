import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeResult(id: string, location: string) {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location,
      variable: "high_temp_f",
      comparator: ">=",
      threshold: 90,
      event_date: "2026-07-03",
    },
    market_prob: 0.72,
    model_prob: 0.8,
    model_prob_raw: 0.8,
    n_members: 30,
    edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
    settlement: null,
  };
}

const LIVE_OUTPUT = {
  schema_version: "1.2",
  generated_at: "2026-07-03T12:04:31+00:00",
  results: [makeResult("a", "NYC"), makeResult("b", "CHI"), makeResult("c", "NYC")],
  aggregate: {
    n_scenarios: 3,
    n_settled: 0,
    mean_brier_market: null,
    mean_brier_model: null,
    better_calibrated: null,
  },
  live: {
    fetched_at: "2026-07-03T12:04:31+00:00",
    cities_ok: ["NYC", "CHI"],
    cities_failed: [],
    quotes_age_seconds: 3,
    ensembles_age_seconds: 90,
    cities: {
      NYC: { name: "New York", station: "Central Park", series: "KXHIGHNY" },
      CHI: { name: "Chicago", station: "Midway", series: "KXHIGHCHI" },
    },
    model_highs: {
      NYC: { ncep_nbm_conus: 91.4, gfs_hrrr: 92.0, gfs_global: 95.2, consensus: 91.8 },
      CHI: { ncep_nbm_conus: 88.1, gfs_hrrr: 88.9, gfs_global: null, consensus: 88.5 },
    },
    consensus_sigma: { NYC: 1.6, CHI: 2.5 },
  },
  verification: {
    window_days: 30,
    n_markets: 214,
    n_days: 29,
    kalshi_mismatches: [],
    verification_failed: [],
  },
  model_grades: {
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
      CHI: { consensus: { n_days: 28, mae: 1.7, bias: -0.1, bucket_hit_rate: 0.38 } },
    },
  },
};

function stubLive(liveBody: unknown, status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/live")) return fakeResponse(status, liveBody);
    if (url === "/api/scenario-files")
      return fakeResponse(200, { files: ["sample.json"] });
    return fakeResponse(200, {
      ...LIVE_OUTPUT,
      live: undefined,
      results: [makeResult("f", "NYC")],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("boots in live mode, renders one CityCard per city, shows updated stamp", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  const footers = await screen.findAllByTestId("verification-footer");
  expect(footers).toHaveLength(2);
  expect(screen.getAllByTestId("ladder-row")).toHaveLength(3);
  expect(screen.getByText(/CHICAGO/)).toBeInTheDocument();
  expect(screen.getByText(/MIDWAY/)).toBeInTheDocument();
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
  expect(screen.getByText(/CONSENSUS 91\.8°/)).toBeInTheDocument();
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "CONSENSUS CLOSEST · DAY-AHEAD · LAST 30 DAYS",
  );
});

it("shows partial upstream strip", async () => {
  stubLive({
    ...LIVE_OUTPUT,
    live: {
      ...LIVE_OUTPUT.live,
      cities_failed: [{ city: "MIA", reason: "kalshi: HTTP 503" }],
    },
  });
  render(<App />);
  expect(await screen.findByTestId("upstream-strip")).toHaveTextContent(
    "UPSTREAM PARTIAL — MIA",
  );
});

it("shows unreachable strip on 502", async () => {
  stubLive({ detail: "no live data available: NYC: timeout" }, 502);
  render(<App />);
  expect(await screen.findByTestId("upstream-strip")).toHaveTextContent(
    "UPSTREAM UNREACHABLE",
  );
});

it("switching to FIXTURES fetches files and analyzes", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  await screen.findAllByTestId("city-group");
  fireEvent.click(screen.getByRole("button", { name: "FIXTURES" }));
  expect(
    await screen.findByRole("button", { name: "sample.json" }),
  ).toBeInTheDocument();
});

it("shows SIGNAL LOST when the server itself is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  render(<App />);
  expect(await screen.findByText("SIGNAL LOST")).toBeInTheDocument();
});
