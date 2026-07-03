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
  },
  verification: {
    window_days: 30,
    model: "gfs_seamless",
    n_markets: 214,
    n_days: 29,
    mean_brier_market: 0.091,
    mean_brier_model: 0.117,
    hit_rate_market: 0.72,
    hit_rate_model: 0.62,
    better_calibrated: "market",
    by_city: {
      NYC: {
        n_markets: 30,
        mean_brier_market: 0.08,
        mean_brier_model: 0.1,
        hit_rate_market: 0.75,
        hit_rate_model: 0.64,
      },
      CHI: {
        n_markets: 28,
        mean_brier_market: 0.09,
        mean_brier_model: 0.12,
        hit_rate_market: 0.71,
        hit_rate_model: 0.6,
      },
    },
    yesterday: {
      NYC: {
        date: "2026-07-02",
        observed_high: 88.5,
        source: "ACIS KNYC",
        settled_bucket: "88–89°",
        brier_market: 0.04,
        brier_model: 0.16,
      },
    },
    kalshi_mismatches: [],
    verification_failed: [],
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
