import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeResult(id: string, location: string, threshold = 90) {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location,
      variable: "high_temp_f",
      comparator: ">=",
      threshold,
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
  results: [makeResult("a", "NYC", 90), makeResult("b", "CHI", 88), makeResult("c", "NYC", 92)],
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
    return fakeResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("boots with the first city selected: hero, rail, ladder", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  const railCities = await screen.findAllByTestId("rail-city");
  expect(railCities).toHaveLength(2);
  // CHI sorts first -> selected by default
  expect(railCities[0]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("88.5°");
  expect(screen.getByRole("heading", { name: "Chicago" })).toBeInTheDocument();
  expect(screen.getAllByText(/Midway/).length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("ladder-row")).toHaveLength(1);
  expect(screen.getByText(/Updated/)).toBeInTheDocument();
});

it("switches city from the rail", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  const railCities = await screen.findAllByTestId("rail-city");
  fireEvent.click(railCities[1]); // New York
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("91.8°");
  expect(screen.getAllByTestId("ladder-row")).toHaveLength(2);
  expect(screen.getByTestId("ladder-chart")).toBeInTheDocument(); // 2 buckets -> chart renders
});

it("falls back to the first city when the selected one disappears", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  const railCities = await screen.findAllByTestId("rail-city");
  fireEvent.click(railCities[1]); // select NYC
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("91.8°");
  // next fetch returns CHI only
  stubLive({
    ...LIVE_OUTPUT,
    results: [makeResult("b", "CHI", 88)],
  });
  fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
  expect(await screen.findByRole("heading", { name: "Chicago" })).toBeInTheDocument();
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("88.5°");
});

it("switches views from the sidebar", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  await screen.findAllByTestId("rail-city");
  fireEvent.click(screen.getByRole("button", { name: /Verification/ }));
  expect(screen.getByTestId("no-mismatches")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Model Skill/ }));
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "Consensus closest · day-ahead · last 30 days",
  );
  fireEvent.click(screen.getByRole("button", { name: /Dashboard/ }));
  expect(screen.getByTestId("hero-temp")).toBeInTheDocument();
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

it("shows SIGNAL LOST when the server itself is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  render(<App />);
  expect(await screen.findByText("Signal lost")).toBeInTheDocument();
});

it("keeps content bright on background refreshes and dims only after repeated failures", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  await screen.findAllByTestId("rail-city");
  const main = screen.getByTestId("main-column");
  expect(main).not.toHaveClass("opacity-40");
  // upstream starts failing
  stubLive({ detail: "no live data available: NYC: timeout" }, 502);
  fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
  await screen.findByTestId("upstream-strip");
  expect(main).not.toHaveClass("opacity-40"); // one miss: stay bright, data is fresh enough
  fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
  await vi.waitFor(() => expect(main).toHaveClass("opacity-40")); // stale after two misses
});

it("shows skeleton placeholders while the first load is in flight", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
  render(<App />);
  expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  expect(screen.getByTestId("rail-skeleton")).toBeInTheDocument();
});

it("replaces the skeleton with real content once data arrives", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  await screen.findAllByTestId("rail-city");
  expect(screen.queryByTestId("dashboard-skeleton")).toBeNull();
  expect(screen.queryByTestId("rail-skeleton")).toBeNull();
});
