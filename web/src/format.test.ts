import { describe, expect, it } from "vitest";
import {
  biasWords,
  bucketContains,
  closestModel,
  formatDate,
  formatPercent,
  formatSigned,
  formatTemperature,
  gradeLine,
  markedScenarioId,
  rangeLabel,
  shortRangeLabel,
  sortKey,
} from "./format";
import type { MarketMeta, ModelGrades, ScenarioResult } from "./types";

function market(comparator: string, t?: number, lo?: number, hi?: number): MarketMeta {
  return {
    question: "q",
    location: "AUS",
    variable: "high_temp_f",
    comparator,
    threshold: t,
    threshold_low: lo,
    threshold_high: hi,
    event_date: "2026-07-04",
  };
}

function result(id: string, m: MarketMeta): ScenarioResult {
  return {
    scenario_id: id,
    market: m,
    market_prob: 0.5,
    model_prob: 0.5,
    model_prob_raw: 0.5,
    n_members: 3,
    edge: { value: 0, log_odds_diff: 0, flag: "agreement" },
    settlement: null,
  };
}

it("formats dates as MON DD", () => {
  expect(formatDate("2026-07-04")).toBe("Jul 04");
});

it("formats data values with consistent precision", () => {
  expect(formatTemperature(91.84)).toBe("91.8°");
  expect(formatSigned(0.087)).toBe("+0.09");
  expect(formatSigned(-0.087)).toBe("−0.09");
  expect(formatPercent(0.387)).toBe("39%");
  expect(formatPercent(0.387, 1)).toBe("38.7%");
});

it("labels ranges long and short", () => {
  expect(rangeLabel(market("between", undefined, 96, 97))).toBe("96–97°");
  expect(rangeLabel(market(">=", 102))).toBe("102° or above");
  expect(rangeLabel(market("<=", 93))).toBe("93° or below");
  expect(shortRangeLabel(market("between", undefined, 96, 97))).toBe("96–97");
  expect(shortRangeLabel(market(">=", 102))).toBe("≥102");
  expect(shortRangeLabel(market("<=", 93))).toBe("≤93");
});

it("sorts <= buckets first, then ascending thresholds", () => {
  const rows = [
    result("hi", market(">=", 102)),
    result("mid", market("between", undefined, 96, 97)),
    result("lo", market("<=", 93)),
  ];
  const sorted = rows.slice().sort((a, b) => sortKey(a) - sortKey(b));
  expect(sorted.map((r) => r.scenario_id)).toEqual(["lo", "mid", "hi"]);
});

it("finds the bucket containing the rounded consensus", () => {
  const rows = [
    result("lo", market("<=", 93)),
    result("mid", market("between", undefined, 96, 97)),
    result("hi", market(">=", 102)),
  ];
  expect(markedScenarioId(rows, 96.2)).toBe("mid"); // floor(96.7) = 96
  expect(markedScenarioId(rows, null)).toBeUndefined();
  expect(bucketContains(market("between", undefined, 96, 97), 96)).toBe(true);
  expect(bucketContains(market("between", undefined, 96, 97), 98)).toBe(false);
});

it("words model bias", () => {
  expect(biasWords(0.02)).toBe("NO LEAN");
  expect(biasWords(0.9)).toBe("RUNS +0.9° WARM");
  expect(biasWords(-0.9)).toBe("RUNS −0.9° COOL");
});

it("builds grade lines", () => {
  expect(gradeLine("gfs_hrrr", { n_days: 28, mae: 2.2, bias: 0.02, bucket_hit_rate: 0.26 }))
    .toBe("HRRR · OFF BY 2.2°F · RIGHT BUCKET 26% · NO LEAN");
  expect(gradeLine("gfs_global", { n_days: 28, mae: 2.16, bias: 0.79, bucket_hit_rate: null }))
    .toBe("GFS · OFF BY 2.2°F · RUNS +0.8° WARM");
});

describe("closestModel", () => {
  const base: ModelGrades = { window_days: 30, lead: "day_ahead", overall: {}, by_city: {} };
  it("picks lowest MAE, tie-broken by hit rate", () => {
    expect(
      closestModel({
        ...base,
        overall: {
          gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.4 },
          gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.3 },
        },
      }),
    ).toBe("gfs_hrrr");
  });
  it("returns null on a dead tie", () => {
    expect(
      closestModel({
        ...base,
        overall: {
          gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.3 },
          gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.3 },
        },
      }),
    ).toBeNull();
  });
});
