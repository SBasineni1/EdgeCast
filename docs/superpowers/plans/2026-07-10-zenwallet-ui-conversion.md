# ZenWallet-Style UI Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the EdgeCast web dashboard from its terminal/mono single-column layout to the ZenWallet-reference three-region layout (sidebar + main + right rail) with lime/charcoal visual identity and GSAP motion, preserving all data logic.

**Architecture:** Frontend-only recomposition of `web/`. Shared display helpers extracted to `web/src/format.ts`; six new leaf components + two view components replace `CommandBar`/`CityCard`/`AggregateStrip`; `App.tsx` orchestrates view + selected-city state. The chart is hand-rolled SVG animated with GSAP. No backend changes, no router, no chart library.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 (`@theme` tokens), GSAP 3, Vitest + Testing Library (jsdom), Vite 6. New dependency: `@fontsource/space-grotesk` only.

**Spec:** `docs/superpowers/specs/2026-07-10-zenwallet-ui-conversion-design.md`

## Global Constraints

- **Do NOT run `git commit` or `git push`. Ever.** The user commits at task boundaries. End every task by running the full web test suite and reporting results instead.
- All commands run from `web/` (e.g. `cd /Users/suchitbasineni/Documents/GitHub/EdgeCast/web`).
- Test all: `npm test` (vitest run). Single file: `npx vitest run src/components/LadderTable.test.tsx`. Build/typecheck: `npm run build`.
- Only new dependency allowed: `@fontsource/space-grotesk`. No router, no chart library.
- Every GSAP animation must be gated: `const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;` — if `reduce`, skip the tween (jsdom has no `matchMedia`, so tests always take the reduced path).
- No animation assertions in tests.
- Preserve existing `data-testid` values where the plan reuses them (`ladder-row`, `edge-cell`, `consensus-marker`, `mismatch-warning`, `live-dot`, `help-panel`, `upstream-strip`).
- Color token names `--color-up`, `--color-down`, `--color-panel`, `--color-hairline`, `--color-text-1/2/3`, `--color-ink` keep their names (values change); new tokens: `--color-lime`, `--color-lime-ink`, `--color-gold`, `--color-panel-2`.
- Copy style: micro-labels/section headers UPPERCASE with letter-tracking; nav items Title Case. Never use profit/financial-advice language.

---

### Task 1: Theme tokens & Space Grotesk

**Files:**
- Modify: `web/src/theme.css` (full rewrite, 25 lines)
- Modify: `web/package.json` (dependency swap via npm commands)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utility classes used by every later task: `bg-ink`, `bg-panel`, `bg-panel-2`, `bg-lime`, `text-lime`, `text-lime-ink`, `bg-gold`, `text-gold`, `text-text-1/2/3`, `border-hairline`, `text-up`, `text-down`, `bg-up/10`, `bg-down/10`, `font-sans` (Space Grotesk).

- [ ] **Step 1: Swap font dependencies**

```bash
cd /Users/suchitbasineni/Documents/GitHub/EdgeCast/web
npm uninstall @fontsource/inter @fontsource/jetbrains-mono
npm install @fontsource/space-grotesk
```

Expected: package.json `dependencies` now lists `@fontsource/space-grotesk` and no other `@fontsource/*` packages.

- [ ] **Step 2: Rewrite `web/src/theme.css`**

Replace the entire file with:

```css
@import "tailwindcss";
@import "@fontsource/space-grotesk/400.css";
@import "@fontsource/space-grotesk/500.css";
@import "@fontsource/space-grotesk/700.css";

@theme {
  --color-ink: #0b0d08;
  --color-panel: #151812;
  --color-panel-2: #1c2017;
  --color-lime: #b9f641;
  --color-lime-ink: #141609;
  --color-gold: #e8c547;
  --color-text-1: #f2f4ec;
  --color-text-2: #a8ad9e;
  --color-text-3: #6f7565;
  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-up: #4ade80;
  --color-down: #f87171;
  --font-sans: "Space Grotesk", system-ui, sans-serif;
}

body {
  background:
    radial-gradient(60rem 40rem at 8% -10%, rgba(185, 246, 65, 0.07), transparent 60%),
    radial-gradient(50rem 35rem at 100% 0%, rgba(185, 246, 65, 0.04), transparent 60%),
    var(--color-ink);
  color: var(--color-text-1);
  font-family: var(--font-sans);
}
```

Note: `--font-mono` is removed on purpose (JetBrains Mono retired per spec). If any existing file still references `font-mono`, Tailwind falls back to its default mono stack — acceptable until those files are deleted in Task 10.

- [ ] **Step 3: Verify existing suite still passes**

Run: `npm test`
Expected: all existing tests PASS (only token values and fonts changed; class names still resolve).

- [ ] **Step 4: Report task complete for user commit** (no git commands)

---

### Task 2: Shared format helpers (`format.ts`)

**Files:**
- Create: `web/src/format.ts`
- Test: `web/src/format.test.ts`

**Interfaces:**
- Consumes: types from `web/src/types.ts` (`MarketMeta`, `ModelGrades`, `ModelGradeStats`, `ScenarioResult`, `MODEL_NAMES`).
- Produces (exact signatures — later tasks import these from `"../format"`):
  - `formatDate(isoDate: string): string` — `"2026-07-04"` → `"JUL 04"`
  - `rangeLabel(market: MarketMeta): string` — `"96–97°"`, `"102° or above"`, `"93° or below"`, `"above 98°"`, `"below 93°"`
  - `shortRangeLabel(market: MarketMeta): string` — `"96–97"`, `"≥102"`, `"≤93"`, `">98"`, `"<93"`
  - `sortKey(r: ScenarioResult): number`
  - `bucketContains(market: MarketMeta, t: number): boolean`
  - `markedScenarioId(results: ScenarioResult[], consensus: number | null): string | undefined`
  - `biasWords(bias: number): string`
  - `gradeLine(model: string, g: ModelGradeStats): string`
  - `closestModel(grades: ModelGrades): string | null`

These are verbatim moves of the private helpers in `CityCard.tsx` and `AggregateStrip.tsx` (do not change their logic), plus two new ones (`shortRangeLabel`, `markedScenarioId`). `CityCard.tsx`/`AggregateStrip.tsx` keep their private copies untouched — they are deleted whole in Task 10.

- [ ] **Step 1: Write the failing test**

Create `web/src/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  biasWords,
  bucketContains,
  closestModel,
  formatDate,
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
  expect(formatDate("2026-07-04")).toBe("JUL 04");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/format.test.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Implement `web/src/format.ts`**

```ts
import type { MarketMeta, ModelGrades, ModelGradeStats, ScenarioResult } from "./types";
import { MODEL_NAMES } from "./types";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

export function rangeLabel(market: MarketMeta): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}°`;
  if (market.comparator === ">=") return `${market.threshold}° or above`;
  if (market.comparator === "<=") return `${market.threshold}° or below`;
  if (market.comparator === ">") return `above ${market.threshold}°`;
  return `below ${market.threshold}°`;
}

export function shortRangeLabel(market: MarketMeta): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}`;
  if (market.comparator === ">=") return `≥${market.threshold}`;
  if (market.comparator === "<=") return `≤${market.threshold}`;
  if (market.comparator === ">") return `>${market.threshold}`;
  return `<${market.threshold}`;
}

export function sortKey(r: ScenarioResult): number {
  const m = r.market;
  if (m.comparator === "between") return m.threshold_low ?? 0;
  if (m.comparator === "<=" || m.comparator === "<") return (m.threshold ?? 0) - 1000;
  return m.threshold ?? 0;
}

export function bucketContains(market: MarketMeta, t: number): boolean {
  if (market.comparator === "between")
    return (market.threshold_low ?? NaN) <= t && t <= (market.threshold_high ?? NaN);
  const thr = market.threshold ?? NaN;
  if (market.comparator === ">") return t > thr;
  if (market.comparator === ">=") return t >= thr;
  if (market.comparator === "<") return t < thr;
  return t <= thr;
}

export function markedScenarioId(
  results: ScenarioResult[],
  consensus: number | null,
): string | undefined {
  if (consensus === null) return undefined;
  const t = Math.floor(consensus + 0.5);
  return results.find((r) => bucketContains(r.market, t))?.scenario_id;
}

export function biasWords(bias: number): string {
  if (Math.abs(bias) < 0.05) return "NO LEAN";
  const sign = bias > 0 ? "+" : "−";
  return `RUNS ${sign}${Math.abs(bias).toFixed(1)}° ${bias > 0 ? "WARM" : "COOL"}`;
}

export function gradeLine(model: string, g: ModelGradeStats): string {
  const hit = g.bucket_hit_rate === null
    ? ""
    : ` · RIGHT BUCKET ${Math.round(g.bucket_hit_rate * 100)}%`;
  return `${MODEL_NAMES[model] ?? model.toUpperCase()} · OFF BY ${g.mae.toFixed(1)}°F${hit} · ${biasWords(g.bias)}`;
}

export function closestModel(grades: ModelGrades): string | null {
  const entries = Object.entries(grades.overall);
  if (entries.length === 0) return null;
  const hit = (r: number | null) => r ?? -1;
  entries.sort(
    ([, a], [, b]) => a.mae - b.mae || hit(b.bucket_hit_rate) - hit(a.bucket_hit_rate),
  );
  const [name, best] = entries[0];
  const rival = entries[1]?.[1];
  if (rival && rival.mae === best.mae && hit(rival.bucket_hit_rate) === hit(best.bucket_hit_rate)) {
    return null;
  }
  return name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 3: LadderTable

**Files:**
- Create: `web/src/components/LadderTable.tsx`
- Test: `web/src/components/LadderTable.test.tsx`

**Interfaces:**
- Consumes: `rangeLabel`, `sortKey`, `markedScenarioId` from `"../format"`; types `KalshiMismatch`, `ScenarioResult`.
- Produces: `LadderTable({ results, consensus, mismatches }: { results: ScenarioResult[]; consensus: number | null; mismatches: KalshiMismatch[] })` — sorts internally, computes the ▸ marker internally. Test ids: `ladder-table`, `ladder-row`, `edge-cell`, `consensus-marker`, `mismatch-warning`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/LadderTable.test.tsx` (assertions ported from `CityCard.test.tsx`):

```tsx
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
  render(<LadderTable results={results} consensus={null} mismatches={[]} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("93° or below");
  expect(rows[1]).toHaveTextContent("96–97°");
  expect(rows[2]).toHaveTextContent("102° or above");
});

it("renders percentages and colored edge chips", () => {
  render(<LadderTable results={results} consensus={null} mismatches={[]} />);
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

it("marks the ladder row containing the rounded consensus", () => {
  render(<LadderTable results={results} consensus={96.2} mismatches={[]} />);
  const marker = screen.getByTestId("consensus-marker");
  expect(marker.closest("[data-testid='ladder-row']")!.textContent).toContain("96–97°");
});

it("omits the marker without consensus", () => {
  render(<LadderTable results={results} consensus={null} mismatches={[]} />);
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
  render(<LadderTable results={[settled]} consensus={null} mismatches={[]} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("YES ●");
});

it("renders red mismatch warnings", () => {
  render(
    <LadderTable
      results={results}
      consensus={null}
      mismatches={[{ market_id: "X", kalshi_result: "yes", edgecast_outcome: 0 }]}
    />,
  );
  const warn = screen.getByTestId("mismatch-warning");
  expect(warn.className).toContain("text-down");
  expect(warn).toHaveTextContent("KALSHI SETTLED YES — EDGECAST COMPUTES NO");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/LadderTable.test.tsx`
Expected: FAIL — `Cannot find module './LadderTable'`.

- [ ] **Step 3: Implement `web/src/components/LadderTable.tsx`**

```tsx
import type { KalshiMismatch, ScenarioResult } from "../types";
import { markedScenarioId, rangeLabel, sortKey } from "../format";

const GRID = "grid grid-cols-[1fr_5.5rem_5.5rem_6rem] items-center gap-4";

function ProbCell({ value, tone }: { value: number; tone: "gold" | "lime" }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <span className="text-sm tabular-nums">{Math.round(value * 100)}%</span>
      <div className="mt-1 h-1 rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${tone === "gold" ? "bg-gold" : "bg-lime"}`}
          style={{ width: `${pct}%`, transition: "width 300ms ease-out" }}
        />
      </div>
    </div>
  );
}

function EdgeCell({ r }: { r: ScenarioResult }) {
  if (r.settlement !== null) {
    const won = r.settlement.outcome === 1;
    return (
      <span className="justify-self-end text-sm tabular-nums" data-testid="edge-cell">
        {won ? "YES ●" : "NO"}
      </span>
    );
  }
  if (r.edge.flag === "agreement") {
    return (
      <span className="justify-self-end text-text-3" data-testid="edge-cell">
        —
      </span>
    );
  }
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`justify-self-end rounded-full px-2.5 py-1 text-xs tabular-nums ${
        up ? "bg-up/10 text-up" : "bg-down/10 text-down"
      }`}
      title={up ? "model higher" : "market higher"}
      data-testid="edge-cell"
    >
      {up ? "▲ +" : "▼ "}
      {r.edge.value.toFixed(2)}
    </span>
  );
}

interface LadderTableProps {
  results: ScenarioResult[];
  consensus: number | null;
  mismatches: KalshiMismatch[];
}

export function LadderTable({ results, consensus, mismatches }: LadderTableProps) {
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const markedId = markedScenarioId(sorted, consensus);
  return (
    <section className="rounded-2xl bg-panel p-5" data-anim="table" data-testid="ladder-table">
      <div className={`${GRID} pb-3 text-[10px] tracking-[0.25em] text-text-3`}>
        <span>RANGE</span>
        <span>MARKET</span>
        <span>MODEL</span>
        <span className="justify-self-end">EDGE</span>
      </div>
      <ul>
        {sorted.map((r) => (
          <li
            key={r.scenario_id}
            className={`${GRID} border-b border-hairline py-3 text-sm last:border-0`}
            data-testid="ladder-row"
          >
            <span>
              {r.scenario_id === markedId && (
                <span className="pr-1 text-lime" title="consensus lands here" data-testid="consensus-marker">
                  ▸
                </span>
              )}
              {rangeLabel(r.market)}
            </span>
            <ProbCell value={r.market_prob} tone="gold" />
            <ProbCell value={r.model_prob} tone="lime" />
            <EdgeCell r={r} />
          </li>
        ))}
      </ul>
      {mismatches.length > 0 && (
        <footer className="pt-3 text-xs">
          {mismatches.map((m) => (
            <p key={m.market_id} className="text-down" data-testid="mismatch-warning">
              ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
              {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
            </p>
          ))}
        </footer>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/LadderTable.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 4: LadderChart (hand-rolled SVG)

**Files:**
- Create: `web/src/components/LadderChart.tsx`
- Test: `web/src/components/LadderChart.test.tsx`

**Interfaces:**
- Consumes: `shortRangeLabel`, `sortKey`, `markedScenarioId` from `"../format"`; `gsap`.
- Produces: `LadderChart({ results, consensus }: { results: ScenarioResult[]; consensus: number | null })`. Returns `null` when fewer than 2 buckets. Test ids: `ladder-chart`, `market-line`, `model-line`, `chart-consensus-line`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/LadderChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { LadderChart } from "./LadderChart";

function row(id: string, comparator: string, t?: number, lo?: number, hi?: number, market = 0.5, model = 0.5): ScenarioResult {
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
    market_prob: market,
    model_prob: model,
    model_prob_raw: model,
    n_members: 3,
    edge: { value: model - market, log_odds_diff: 0, flag: "agreement" },
    settlement: null,
  };
}

const results = [
  row("lo", "<=", 93, undefined, undefined, 0.1, 0.05),
  row("mid", "between", undefined, 96, 97, 0.6, 0.72),
  row("hi", ">=", 102, undefined, undefined, 0.3, 0.23),
];

it("renders two lines, pills with end values, and bucket labels", () => {
  render(<LadderChart results={results} consensus={null} />);
  expect(screen.getByTestId("ladder-chart")).toBeInTheDocument();
  expect(screen.getByTestId("market-line")).toBeInTheDocument();
  expect(screen.getByTestId("model-line")).toBeInTheDocument();
  // pills show the last (highest) bucket's values
  expect(screen.getByText("MARKET 30%")).toBeInTheDocument();
  expect(screen.getByText("MODEL 23%")).toBeInTheDocument();
  // compact x-axis labels
  expect(screen.getByText("≤93")).toBeInTheDocument();
  expect(screen.getByText("96–97")).toBeInTheDocument();
  expect(screen.getByText("≥102")).toBeInTheDocument();
});

it("draws a consensus marker line at the marked bucket", () => {
  render(<LadderChart results={results} consensus={96.2} />);
  expect(screen.getByTestId("chart-consensus-line")).toBeInTheDocument();
});

it("omits the consensus line without consensus", () => {
  render(<LadderChart results={results} consensus={null} />);
  expect(screen.queryByTestId("chart-consensus-line")).toBeNull();
});

it("renders nothing with fewer than two buckets", () => {
  const { container } = render(<LadderChart results={[results[0]]} consensus={null} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/LadderChart.test.tsx`
Expected: FAIL — `Cannot find module './LadderChart'`.

- [ ] **Step 3: Implement `web/src/components/LadderChart.tsx`**

```tsx
import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ScenarioResult } from "../types";
import { markedScenarioId, shortRangeLabel, sortKey } from "../format";

const W = 640;
const H = 210;
const PAD_X = 28;
const PAD_TOP = 20;
const PAD_BOTTOM = 34;
const PILL_W = 96;
const PILL_H = 22;
const PLOT_RIGHT = W - PAD_X - PILL_W - 10;

function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return PAD_X + (i * (PLOT_RIGHT - PAD_X)) / (n - 1);
}

function yAt(p: number): number {
  return PAD_TOP + (1 - p) * (H - PAD_TOP - PAD_BOTTOM);
}

function linePath(probs: number[]): string {
  return probs
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i, probs.length).toFixed(1)},${yAt(p).toFixed(1)}`)
    .join(" ");
}

/** Nudge pill centers apart when the two line ends nearly overlap. */
function pillYs(a: number, b: number): [number, number] {
  if (Math.abs(a - b) >= PILL_H + 4) return [a, b];
  const mid = (a + b) / 2;
  const off = (PILL_H + 4) / 2;
  return a <= b ? [mid - off, mid + off] : [mid + off, mid - off];
}

function Pill({ x, y, fill, label }: { x: number; y: number; fill: string; label: string }) {
  return (
    <g>
      <rect x={x} y={y - PILL_H / 2} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill={fill} />
      <text
        x={x + PILL_W / 2}
        y={y + 3.5}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="#141609"
      >
        {label}
      </text>
    </g>
  );
}

interface LadderChartProps {
  results: ScenarioResult[];
  consensus: number | null;
}

export function LadderChart({ results, consensus }: LadderChartProps) {
  const marketRef = useRef<SVGPathElement>(null);
  const modelRef = useRef<SVGPathElement>(null);
  const pillsRef = useRef<SVGGElement>(null);
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const n = sorted.length;

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    const paths = [marketRef.current, modelRef.current].filter(
      (p): p is SVGPathElement => p !== null && typeof p.getTotalLength === "function",
    );
    const tweens = paths.map((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      return gsap.to(p, { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" });
    });
    if (pillsRef.current !== null) {
      tweens.push(
        gsap.from(pillsRef.current, {
          scale: 0.8,
          autoAlpha: 0,
          transformOrigin: "left center",
          duration: 0.3,
          delay: 0.7,
          ease: "back.out(2)",
        }),
      );
    }
    return () => tweens.forEach((t) => t.kill());
  }, [results]);

  if (n < 2) return null;

  const marketD = linePath(sorted.map((r) => r.market_prob));
  const modelD = linePath(sorted.map((r) => r.model_prob));
  const last = sorted[n - 1];
  const lastX = xAt(n - 1, n);
  const [pillMarketY, pillModelY] = pillYs(yAt(last.market_prob), yAt(last.model_prob));
  const markedId = markedScenarioId(sorted, consensus);
  const markedIdx = sorted.findIndex((r) => r.scenario_id === markedId);

  return (
    <section className="rounded-2xl bg-panel p-5" data-anim="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="market vs model probability by temperature bucket"
        data-testid="ladder-chart"
      >
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={yAt(p)}
            y2={yAt(p)}
            stroke="rgba(255,255,255,0.07)"
            strokeDasharray="3 5"
          />
        ))}
        {markedIdx >= 0 && (
          <line
            x1={xAt(markedIdx, n)}
            x2={xAt(markedIdx, n)}
            y1={PAD_TOP}
            y2={H - PAD_BOTTOM}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="2 5"
            data-testid="chart-consensus-line"
          />
        )}
        <path
          ref={marketRef}
          d={marketD}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(232,197,71,0.35))" }}
          data-testid="market-line"
        />
        <path
          ref={modelRef}
          d={modelD}
          fill="none"
          stroke="var(--color-lime)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(185,246,65,0.4))" }}
          data-testid="model-line"
        />
        <g ref={pillsRef}>
          <Pill
            x={lastX + 10}
            y={pillModelY}
            fill="var(--color-lime)"
            label={`MODEL ${Math.round(last.model_prob * 100)}%`}
          />
          <Pill
            x={lastX + 10}
            y={pillMarketY}
            fill="var(--color-gold)"
            label={`MARKET ${Math.round(last.market_prob * 100)}%`}
          />
        </g>
        {sorted.map((r, i) => (
          <text
            key={r.scenario_id}
            x={xAt(i, n)}
            y={H - 12}
            textAnchor="middle"
            fontSize="11"
            fill="var(--color-text-3)"
          >
            {shortRangeLabel(r.market)}
          </text>
        ))}
      </svg>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/LadderChart.test.tsx`
Expected: PASS (4 tests). (jsdom lacks `matchMedia` → reduce=true → no tweens; the `getTotalLength` guard is belt-and-braces.)

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 5: CityHero (count-up headline)

**Files:**
- Create: `web/src/components/CityHero.tsx`
- Test: `web/src/components/CityHero.test.tsx`

**Interfaces:**
- Consumes: `formatDate` from `"../format"`; `CityInfo`, `MODEL_NAMES`, `MODEL_ORDER` from `"../types"`; `gsap`.
- Produces: `CityHero({ location, cityInfo, eventDate, consensus, sigma, modelHighs }: { location: string; cityInfo?: CityInfo; eventDate?: string; consensus: number | null; sigma?: number | null; modelHighs?: Record<string, number | null> })`. Test ids: `hero-temp`, `hero-models`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/CityHero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CityHero } from "./CityHero";

const props = {
  location: "AUS",
  cityInfo: { name: "Austin", station: "Bergstrom Intl", series: "KXHIGHAUS" },
  eventDate: "2026-07-04",
  consensus: 96.2,
  sigma: 1.8,
  modelHighs: { ncep_nbm_conus: 96.4, gfs_hrrr: 98.0, gfs_global: 102.2, consensus: 96.2 },
};

it("renders city name, station, date, and consensus temp", () => {
  render(<CityHero {...props} />);
  expect(screen.getByText("Austin")).toBeInTheDocument();
  expect(screen.getByText(/BERGSTROM INTL · JUL 04/)).toBeInTheDocument();
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("96.2°");
  expect(screen.getByText(/σ 1\.8°/)).toBeInTheDocument();
});

it("lists per-model highs", () => {
  render(<CityHero {...props} />);
  expect(screen.getByTestId("hero-models")).toHaveTextContent("NBM 96.4 · HRRR 98.0 · GFS 102.2");
});

it("shows an em dash without consensus", () => {
  render(<CityHero {...props} consensus={null} sigma={null} modelHighs={undefined} />);
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("—");
  expect(screen.queryByTestId("hero-models")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CityHero.test.tsx`
Expected: FAIL — `Cannot find module './CityHero'`.

- [ ] **Step 3: Implement `web/src/components/CityHero.tsx`**

```tsx
import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { CityInfo } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { formatDate } from "../format";

const SOURCE_ORDER = MODEL_ORDER.filter((m) => m !== "consensus");

interface CityHeroProps {
  location: string;
  cityInfo?: CityInfo;
  eventDate?: string;
  consensus: number | null;
  sigma?: number | null;
  modelHighs?: Record<string, number | null>;
}

export function CityHero({ location, cityInfo, eventDate, consensus, sigma, modelHighs }: CityHeroProps) {
  const numRef = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);

  // Count-up: animate from the previous displayed value to the new one.
  useEffect(() => {
    const el = numRef.current;
    if (el === null || consensus === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    const from = prev.current;
    prev.current = consensus;
    if (reduce) {
      el.textContent = `${consensus.toFixed(1)}°`;
      return;
    }
    const obj = { v: from };
    const tween = gsap.to(obj, {
      v: consensus,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = `${obj.v.toFixed(1)}°`;
      },
    });
    return () => {
      tween.kill();
    };
  }, [consensus]);

  const sourceHighs = SOURCE_ORDER.filter((m) => modelHighs?.[m] != null)
    .map((m) => `${MODEL_NAMES[m]} ${(modelHighs![m] as number).toFixed(1)}`)
    .join(" · ");

  return (
    <section className="pb-2" data-anim="hero">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-medium">{cityInfo?.name ?? location}</h1>
        <span className="text-xs tracking-[0.15em] text-text-3">
          {cityInfo ? `${cityInfo.station.toUpperCase()} · ` : ""}
          {eventDate ? formatDate(eventDate) : ""}
        </span>
      </div>
      <p className="pt-2 text-[10px] tracking-[0.3em] text-text-3">CONSENSUS HIGH</p>
      <p className="pt-1">
        <span ref={numRef} data-testid="hero-temp" className="text-6xl font-medium tabular-nums tracking-tight">
          {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
        </span>
        {sigma != null && <span className="pl-3 text-sm tabular-nums text-text-3">σ {sigma.toFixed(1)}°</span>}
      </p>
      {sourceHighs && (
        <p className="pt-2 text-xs tabular-nums text-text-3" data-testid="hero-models">
          {sourceHighs}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CityHero.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 6: CityRail (cities + top edges)

**Files:**
- Create: `web/src/components/CityRail.tsx`
- Test: `web/src/components/CityRail.test.tsx`

**Interfaces:**
- Consumes: `rangeLabel` from `"../format"`; `CityInfo`, `ScenarioResult` from `"../types"`.
- Produces: `CityRail({ groups, cities, modelHighs, selected, onSelect }: { groups: [string, ScenarioResult[]][]; cities: Record<string, CityInfo>; modelHighs?: Record<string, Record<string, number | null>>; selected: string | null; onSelect: (location: string) => void })`. Test ids: `rail-city` (buttons, `aria-pressed` marks selection), `top-edge` (buttons).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/CityRail.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CityRail.test.tsx`
Expected: FAIL — `Cannot find module './CityRail'`.

- [ ] **Step 3: Implement `web/src/components/CityRail.tsx`**

```tsx
import type { CityInfo, ScenarioResult } from "../types";
import { rangeLabel } from "../format";

function flagged(results: ScenarioResult[]): ScenarioResult[] {
  return results.filter((r) => r.settlement === null && r.edge.flag !== "agreement");
}

function biggestEdge(results: ScenarioResult[]): ScenarioResult | null {
  const rows = flagged(results);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (Math.abs(b.edge.value) > Math.abs(a.edge.value) ? b : a));
}

function EdgeBadge({ r }: { r: ScenarioResult }) {
  const up = r.edge.flag === "model_higher";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
        up ? "bg-up/10 text-up" : "bg-down/10 text-down"
      }`}
    >
      {up ? "▲ +" : "▼ "}
      {r.edge.value.toFixed(2)}
    </span>
  );
}

interface CityRailProps {
  groups: [string, ScenarioResult[]][];
  cities: Record<string, CityInfo>;
  modelHighs?: Record<string, Record<string, number | null>>;
  selected: string | null;
  onSelect: (location: string) => void;
}

export function CityRail({ groups, cities, modelHighs, selected, onSelect }: CityRailProps) {
  const topEdges = groups
    .flatMap(([loc, results]) => flagged(results).map((r) => ({ loc, r })))
    .sort((a, b) => Math.abs(b.r.edge.value) - Math.abs(a.r.edge.value))
    .slice(0, 6);
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-8 px-5 py-7">
      <section>
        <p className="pb-3 text-[10px] tracking-[0.3em] text-text-3">CITIES</p>
        <ul className="flex flex-col gap-2">
          {groups.map(([loc, results]) => {
            const consensus = modelHighs?.[loc]?.consensus ?? null;
            const big = biggestEdge(results);
            const active = loc === selected;
            return (
              <li key={loc} data-anim="rail-item">
                <button
                  onClick={() => onSelect(loc)}
                  aria-pressed={active}
                  data-testid="rail-city"
                  className={`flex w-full items-center justify-between gap-2 rounded-2xl p-4 text-left transition-colors duration-150 ${
                    active ? "bg-panel-2 ring-1 ring-lime/40" : "bg-panel hover:bg-panel-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{cities[loc]?.name ?? loc}</span>
                    <span className="block truncate text-[11px] text-text-3">{cities[loc]?.station ?? ""}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-lg font-medium tabular-nums">
                      {consensus !== null ? `${consensus.toFixed(1)}°` : "—"}
                    </span>
                    {big !== null ? <EdgeBadge r={big} /> : <span className="text-[11px] text-text-3">—</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {topEdges.length > 0 && (
        <section>
          <p className="pb-3 text-[10px] tracking-[0.3em] text-text-3">TOP EDGES</p>
          <ul className="flex flex-col">
            {topEdges.map(({ loc, r }) => (
              <li key={r.scenario_id} data-anim="rail-item">
                <button
                  onClick={() => onSelect(loc)}
                  data-testid="top-edge"
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-panel-2"
                >
                  <span className="min-w-0">
                    <span className="block text-xs">{cities[loc]?.name ?? loc}</span>
                    <span className="block text-[11px] text-text-3">{rangeLabel(r.market)}</span>
                  </span>
                  <EdgeBadge r={r} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CityRail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 7: Sidebar (nav, help, threshold) + HelpPanel restyle

**Files:**
- Create: `web/src/components/Sidebar.tsx`
- Modify: `web/src/components/HelpPanel.tsx` (one className line)
- Test: `web/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `HelpPanel` from `"./HelpPanel"`.
- Produces: `export type View = "dashboard" | "verification" | "skill";` and `Sidebar({ view, onView, threshold, onThreshold }: { view: View; onView: (v: View) => void; threshold: number; onThreshold: (t: number) => void })`. Nav buttons carry `aria-current="page"` when active. Threshold buttons keep aria-labels `"decrease threshold"` / `"increase threshold"`; help button keeps aria-label `"help"`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/Sidebar.test.tsx` (threshold + help assertions ported from `CommandBar.test.tsx`):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const props = {
  view: "dashboard" as const,
  onView: vi.fn(),
  threshold: 0.05,
  onThreshold: vi.fn(),
};

it("marks the active view and switches on click", () => {
  const onView = vi.fn();
  render(<Sidebar {...props} onView={onView} />);
  const dash = screen.getByRole("button", { name: /Dashboard/ });
  expect(dash).toHaveAttribute("aria-current", "page");
  const verify = screen.getByRole("button", { name: /Verification/ });
  expect(verify).not.toHaveAttribute("aria-current");
  fireEvent.click(verify);
  expect(onView).toHaveBeenCalledWith("verification");
  fireEvent.click(screen.getByRole("button", { name: /Model Skill/ }));
  expect(onView).toHaveBeenCalledWith("skill");
});

it("steps the threshold within [0,1]", () => {
  const onThreshold = vi.fn();
  render(<Sidebar {...props} threshold={0.0} onThreshold={onThreshold} />);
  fireEvent.click(screen.getByRole("button", { name: "decrease threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "increase threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.01);
});

it("help panel opens with FAQ content and closes", () => {
  render(<Sidebar {...props} />);
  expect(screen.queryByTestId("help-panel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "help" }));
  const panel = screen.getByTestId("help-panel");
  expect(panel).toHaveTextContent("RIGHT BUCKET");
  expect(panel).toHaveTextContent("CONSENSUS");
  fireEvent.click(screen.getByRole("button", { name: "close help" }));
  expect(screen.queryByTestId("help-panel")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — `Cannot find module './Sidebar'`.

- [ ] **Step 3: Implement `web/src/components/Sidebar.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { HelpPanel } from "./HelpPanel";

export type View = "dashboard" | "verification" | "skill";

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8.5 8 3l6 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 8.5V13h8V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconVerification() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m5.8 8 1.6 1.6L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSkill() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 13V9M8 13V5M13 13V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.3 6.2c.2-1 1-1.5 1.9-1.4.9 0 1.7.7 1.7 1.6 0 1.2-1.6 1.4-1.9 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
    </svg>
  );
}

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { id: "verification", label: "Verification", icon: <IconVerification /> },
  { id: "skill", label: "Model Skill", icon: <IconSkill /> },
];

interface SidebarProps {
  view: View;
  onView: (v: View) => void;
  threshold: number;
  onThreshold: (t: number) => void;
}

export function Sidebar({ view, onView, threshold, onThreshold }: SidebarProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-8 px-5 py-7">
      <span className="text-lg tracking-tight" data-anim="sidebar-item">
        <span className="font-bold">Edge</span>Cast<span className="text-lime">.</span>
      </span>
      <nav>
        <p className="pb-3 text-[10px] tracking-[0.3em] text-text-3" data-anim="sidebar-item">
          MENU
        </p>
        <ul className="flex flex-col gap-1.5">
          {NAV.map(({ id, label, icon }) => (
            <li key={id} data-anim="sidebar-item">
              <button
                onClick={() => onView(id)}
                aria-current={view === id ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors duration-150 ${
                  view === id ? "bg-lime font-medium text-lime-ink" : "text-text-2 hover:bg-panel-2"
                }`}
              >
                {icon}
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <p className="pb-3 text-[10px] tracking-[0.3em] text-text-3" data-anim="sidebar-item">
          OTHER
        </p>
        <button
          onClick={() => setHelpOpen((o) => !o)}
          aria-expanded={helpOpen}
          aria-label="help"
          data-anim="sidebar-item"
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-text-2 transition-colors duration-150 hover:bg-panel-2"
        >
          <IconHelp />
          Help Center
        </button>
      </div>
      <div className="mt-auto rounded-2xl bg-panel p-4" data-anim="sidebar-item">
        <p className="pb-2 text-[10px] tracking-[0.3em] text-text-3">FLAG ≥</p>
        <div className="flex items-center justify-between">
          <button
            aria-label="decrease threshold"
            onClick={() => step(-0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            −
          </button>
          <span className="text-sm tabular-nums">{threshold.toFixed(2)}</span>
          <button
            aria-label="increase threshold"
            onClick={() => step(0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            +
          </button>
        </div>
      </div>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </aside>
  );
}
```

- [ ] **Step 4: Restyle HelpPanel container**

In `web/src/components/HelpPanel.tsx`, change only the container `className` (the `div` with `data-testid="help-panel"`):

```tsx
      className="fixed left-60 top-14 z-50 max-h-[80vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-hairline bg-panel-2 p-5"
```

(Anchored near the sidebar now instead of the old top-right command bar; rounded panel.) Also change the close button class to `rounded-full border border-hairline px-2 text-xs text-text-2`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS (old `CommandBar.test.tsx` still passes; it is removed in Task 10).

---

### Task 8: TopBar

**Files:**
- Create: `web/src/components/TopBar.tsx`
- Test: `web/src/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `gsap`.
- Produces: `TopBar({ updatedAt, busy, onRefresh }: { updatedAt: string | null; busy: boolean; onRefresh: () => void })`. Test id `live-dot`; refresh button text `REFRESH ▸`; busy shows `ANALYZING…`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/TopBar.test.tsx` (ported from `CommandBar.test.tsx`):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

const props = { updatedAt: null, busy: false, onRefresh: vi.fn() };

it("shows the live indicator with dot and updated stamp", () => {
  render(<TopBar {...props} updatedAt="2026-07-03T12:04:31+00:00" />);
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  expect(screen.getByTestId("live-dot")).toBeInTheDocument();
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
});

it("fires onRefresh and shows busy state", () => {
  const { rerender } = render(<TopBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /REFRESH/ }));
  expect(props.onRefresh).toHaveBeenCalled();
  rerender(<TopBar {...props} busy={true} />);
  expect(screen.getByText("ANALYZING…")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TopBar.test.tsx`
Expected: FAIL — `Cannot find module './TopBar'`.

- [ ] **Step 3: Implement `web/src/components/TopBar.tsx`**

```tsx
import { useEffect, useRef } from "react";
import gsap from "gsap";

interface TopBarProps {
  updatedAt: string | null;
  busy: boolean;
  onRefresh: () => void;
}

export function TopBar({ updatedAt, busy, onRefresh }: TopBarProps) {
  const dotRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce || dotRef.current === null) return;
    const pulse = gsap.to(dotRef.current, {
      autoAlpha: 0.2,
      duration: 0.8,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
    return () => {
      pulse.kill();
    };
  }, []);
  return (
    <header className="flex items-center gap-4 pb-6">
      <span className="flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-xs tracking-[0.2em] text-lime">
        <span ref={dotRef} data-testid="live-dot" className="inline-block h-1.5 w-1.5 rounded-full bg-lime" />
        LIVE
      </span>
      {busy && <span className="text-xs text-text-3">ANALYZING…</span>}
      <div className="ml-auto flex items-center gap-4">
        {updatedAt !== null && (
          <span className="text-xs tabular-nums text-text-3">
            UPDATED {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
        <button
          onClick={onRefresh}
          className="rounded-full bg-lime px-4 py-1.5 text-xs font-medium tracking-widest text-lime-ink transition-opacity duration-150 hover:opacity-90"
        >
          REFRESH ▸
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/TopBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 9: SkillView & VerificationView

**Files:**
- Create: `web/src/components/SkillView.tsx`
- Create: `web/src/components/VerificationView.tsx`
- Test: `web/src/components/SkillView.test.tsx`
- Test: `web/src/components/VerificationView.test.tsx`

**Interfaces:**
- Consumes: `closestModel`, `gradeLine` from `"../format"`; `CityInfo`, `ModelGrades`, `VerificationInfo`, `MODEL_NAMES`, `MODEL_ORDER` from `"../types"`.
- Produces:
  - `SkillView({ modelGrades, cities }: { modelGrades: ModelGrades | null | undefined; cities: Record<string, CityInfo> })` — test ids `verdict`, `skill-city`.
  - `VerificationView({ verification }: { verification: VerificationInfo | null | undefined })` — test ids `no-mismatches`, `mismatch-warning`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/SkillView.test.tsx` (verdict assertions ported from `AggregateStrip.test.tsx`):

```tsx
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
    "CONSENSUS CLOSEST · DAY-FORWARD · LAST 30 DAYS",
  );
  expect(screen.getByText("1.5°")).toBeInTheDocument();
  expect(screen.getByText("CONSENSUS RIGHT BUCKET")).toBeInTheDocument();
  expect(screen.getByText("41%")).toBeInTheDocument();
  const city = screen.getByTestId("skill-city");
  expect(city).toHaveTextContent("New York");
  expect(city).toHaveTextContent("CONSENSUS · OFF BY 1.4°F · RIGHT BUCKET 45% · RUNS +0.2° WARM");
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
  expect(screen.getByTestId("verdict")).toHaveTextContent("HRRR CLOSEST");
});

it("null model grades show awaiting-backfill state", () => {
  render(<SkillView modelGrades={null} cities={{}} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING MODEL GRADES");
});
```

Create `web/src/components/VerificationView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { VerificationView } from "./VerificationView";

const base = {
  window_days: 30,
  n_markets: 214,
  n_days: 29,
  kalshi_mismatches: [],
  verification_failed: [],
};

it("renders window stats and the clean-mismatch state", () => {
  render(<VerificationView verification={base} />);
  expect(screen.getByText("30D")).toBeInTheDocument();
  expect(screen.getByText("214")).toBeInTheDocument();
  expect(screen.getByText("29")).toBeInTheDocument();
  expect(screen.getByTestId("no-mismatches")).toBeInTheDocument();
});

it("renders mismatches and failures", () => {
  render(
    <VerificationView
      verification={{
        ...base,
        kalshi_mismatches: [{ market_id: "X", kalshi_result: "yes", edgecast_outcome: 0 }],
        verification_failed: [{ city: "MIA", stage: "obs", reason: "no data" }],
      }}
    />,
  );
  expect(screen.getByTestId("mismatch-warning")).toHaveTextContent(
    "KALSHI SETTLED YES — EDGECAST COMPUTES NO",
  );
  expect(screen.getByText(/MIA · obs · no data/)).toBeInTheDocument();
});

it("renders empty state without verification data", () => {
  render(<VerificationView verification={null} />);
  expect(screen.getByText(/NO VERIFICATION DATA YET/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SkillView.test.tsx src/components/VerificationView.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/src/components/SkillView.tsx`**

```tsx
import type { CityInfo, ModelGrades } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { closestModel, gradeLine } from "../format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-panel p-4">
      <div className="text-[10px] tracking-[0.25em] text-text-3">{label}</div>
      <div className="pt-1 text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface SkillViewProps {
  modelGrades: ModelGrades | null | undefined;
  cities: Record<string, CityInfo>;
}

export function SkillView({ modelGrades, cities }: SkillViewProps) {
  if (modelGrades == null) {
    return (
      <p className="rounded-2xl bg-panel p-5 text-sm text-text-3" data-testid="verdict">
        AWAITING MODEL GRADES — run: uv run edgecast backfill
      </p>
    );
  }
  const models = MODEL_ORDER.filter((m) => modelGrades.overall[m] !== undefined);
  const closest = closestModel(modelGrades);
  const consensusHit = modelGrades.overall.consensus?.bucket_hit_rate ?? null;
  const verdict = closest === null ? "MODELS TIED" : `${MODEL_NAMES[closest] ?? closest} CLOSEST`;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg font-medium" data-testid="verdict">
        {verdict} · DAY-FORWARD · LAST {modelGrades.window_days} DAYS
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {models.map((m) => (
          <Stat key={m} label={`${MODEL_NAMES[m] ?? m} MAE`} value={`${modelGrades.overall[m].mae.toFixed(1)}°`} />
        ))}
        {consensusHit !== null && (
          <Stat label="CONSENSUS RIGHT BUCKET" value={`${Math.round(consensusHit * 100)}%`} />
        )}
      </div>
      {Object.keys(modelGrades.by_city).length > 0 && (
        <section className="rounded-2xl bg-panel p-5">
          <p className="pb-3 text-[10px] tracking-[0.25em] text-text-3">BY CITY</p>
          <div className="flex flex-col gap-4">
            {Object.entries(modelGrades.by_city)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([loc, grades]) => (
                <div key={loc} data-testid="skill-city">
                  <p className="pb-1 text-sm font-medium">{cities[loc]?.name ?? loc}</p>
                  {MODEL_ORDER.filter((m) => grades[m] !== undefined).map((m) => (
                    <p
                      key={m}
                      className={`text-xs tabular-nums ${m === "consensus" ? "text-text-2" : "text-text-3"}`}
                    >
                      {gradeLine(m, grades[m])}
                    </p>
                  ))}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `web/src/components/VerificationView.tsx`**

```tsx
import type { VerificationInfo } from "../types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-panel p-4">
      <div className="text-[10px] tracking-[0.25em] text-text-3">{label}</div>
      <div className="pt-1 text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface VerificationViewProps {
  verification: VerificationInfo | null | undefined;
}

export function VerificationView({ verification }: VerificationViewProps) {
  if (verification == null) {
    return (
      <p className="rounded-2xl bg-panel p-5 text-sm text-text-3">
        NO VERIFICATION DATA YET — run: uv run edgecast backfill
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="WINDOW" value={`${verification.window_days}D`} />
        <Stat label="MARKETS CHECKED" value={`${verification.n_markets}`} />
        <Stat label="DAYS GRADED" value={`${verification.n_days}`} />
      </div>
      <section className="rounded-2xl bg-panel p-5">
        <p className="pb-3 text-[10px] tracking-[0.25em] text-text-3">KALSHI MISMATCHES</p>
        {verification.kalshi_mismatches.length === 0 ? (
          <p className="text-sm text-text-3" data-testid="no-mismatches">
            NONE — SETTLEMENTS MATCH OFFICIAL OBSERVATIONS
          </p>
        ) : (
          verification.kalshi_mismatches.map((m) => (
            <p key={m.market_id} className="text-sm text-down" data-testid="mismatch-warning">
              ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
              {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
            </p>
          ))
        )}
      </section>
      {verification.verification_failed.length > 0 && (
        <section className="rounded-2xl bg-panel p-5">
          <p className="pb-3 text-[10px] tracking-[0.25em] text-text-3">VERIFICATION FAILURES</p>
          {verification.verification_failed.map((f) => (
            <p key={`${f.city}-${f.stage}`} className="text-sm text-text-3">
              {f.city} · {f.stage} · {f.reason}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/SkillView.test.tsx src/components/VerificationView.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Run full suite, report for user commit**

Run: `npm test` — expected: all PASS.

---

### Task 10: App integration — layout, selection, motion; delete old components

**Files:**
- Modify: `web/src/App.tsx` (full rewrite below)
- Modify: `web/src/App.test.tsx` (full rewrite below)
- Delete: `web/src/components/CommandBar.tsx`, `web/src/components/CommandBar.test.tsx`, `web/src/components/CityCard.tsx`, `web/src/components/CityCard.test.tsx`, `web/src/components/AggregateStrip.tsx`, `web/src/components/AggregateStrip.test.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2–9.
- Produces: the shipped app. Selection fallback rule: `selected = selectedCity if it exists in groups, else first group's location, else null`. Rail selection also forces `view = "dashboard"`.

- [ ] **Step 1: Rewrite `web/src/App.test.tsx` (failing against old App)**

```tsx
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
  expect(screen.getByText(/MIDWAY/)).toBeInTheDocument();
  expect(screen.getAllByTestId("ladder-row")).toHaveLength(1);
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: /REFRESH/ }));
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
    "CONSENSUS CLOSEST · DAY-FORWARD · LAST 30 DAYS",
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
  expect(await screen.findByText("SIGNAL LOST")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — old App has no `rail-city`/`hero-temp` elements.

- [ ] **Step 3: Rewrite `web/src/App.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { analyzeLive, InputError, UpstreamError } from "./api";
import type { AnalysisOutput, ScenarioResult } from "./types";
import { CityHero } from "./components/CityHero";
import { CityRail } from "./components/CityRail";
import { LadderChart } from "./components/LadderChart";
import { LadderTable } from "./components/LadderTable";
import { Sidebar, type View } from "./components/Sidebar";
import { SkillView } from "./components/SkillView";
import { TopBar } from "./components/TopBar";
import { VerificationView } from "./components/VerificationView";

const REFRESH_MS = 60_000;

function groupByLocation(results: ScenarioResult[]): [string, ScenarioResult[]][] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    const list = groups.get(r.market.location) ?? [];
    list.push(r);
    groups.set(r.market.location, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function App() {
  const [threshold, setThreshold] = useState(0.05);
  const [view, setView] = useState<View>("dashboard");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entered = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const prevSelected = useRef<string | null>(null);

  const runLive = useCallback(async (th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyzeLive(th));
      setUpstreamError(null);
      setOffline(false);
    } catch (e) {
      if (e instanceof UpstreamError) setUpstreamError(e.message);
      else if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runLive(threshold);
    const timer = setInterval(() => void runLive(threshold), REFRESH_MS);
    return () => clearInterval(timer);
  }, [threshold, runLive]);

  const groups = output !== null ? groupByLocation(output.results) : [];
  const selected =
    selectedCity !== null && groups.some(([l]) => l === selectedCity)
      ? selectedCity
      : groups[0]?.[0] ?? null;

  // Entrance timeline — first data load only.
  useEffect(() => {
    if (output === null || entered.current) return;
    entered.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from("[data-anim='sidebar-item']", { x: -12, autoAlpha: 0, duration: 0.4, stagger: 0.04, clearProps: "all" })
      .from("[data-anim='hero']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.2")
      .from("[data-anim='chart']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.35")
      .from("[data-anim='table']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.35")
      .from("[data-anim='rail-item']", { y: 14, autoAlpha: 0, duration: 0.4, stagger: 0.05, clearProps: "all" }, "-=0.4");
  }, [output]);

  // Quick out/in on city switch.
  useEffect(() => {
    const el = mainRef.current;
    if (el === null || selected === null) return;
    const was = prevSelected.current;
    prevSelected.current = selected;
    if (was === null || was === selected) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    gsap.fromTo(
      el,
      { y: 8, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.25, ease: "power2.out", clearProps: "all" },
    );
  }, [selected]);

  if (offline && output === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-4xl font-bold tracking-[0.3em]">SIGNAL LOST</h1>
        <p className="text-sm text-text-3">is the server running? → uv run edgecast serve</p>
      </main>
    );
  }

  const cities = output?.live?.cities ?? {};
  const selectedResults = selected !== null ? groups.find(([l]) => l === selected)?.[1] ?? [] : [];
  const highs = selected !== null ? output?.live?.model_highs?.[selected] : undefined;
  const consensus = highs?.consensus ?? null;
  const sigma = selected !== null ? output?.live?.consensus_sigma?.[selected] ?? null : null;
  const selectedInfo = selected !== null ? cities[selected] : undefined;
  const mismatches =
    selectedInfo !== undefined
      ? output?.verification?.kalshi_mismatches?.filter((m) =>
          m.market_id.startsWith(selectedInfo.series),
        ) ?? []
      : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-[1480px]">
      <Sidebar view={view} onView={setView} threshold={threshold} onThreshold={setThreshold} />
      <div className="min-w-0 flex-1 px-8 py-7">
        <TopBar
          updatedAt={output?.live?.fetched_at ?? null}
          busy={busy}
          onRefresh={() => void runLive(threshold)}
        />
        {upstreamError !== null && (
          <p className="mb-4 rounded-xl bg-panel px-4 py-2 text-xs text-text-2" data-testid="upstream-strip">
            <span className="font-bold text-text-1">UPSTREAM UNREACHABLE</span> {upstreamError} —
            retrying in 60s
          </p>
        )}
        {upstreamError === null && (output?.live?.cities_failed.length ?? 0) > 0 && (
          <p className="mb-4 rounded-xl bg-panel px-4 py-2 text-xs text-text-2" data-testid="upstream-strip">
            <span className="font-bold text-text-1">UPSTREAM PARTIAL</span> —{" "}
            {output!.live!.cities_failed.map((f) => `${f.city} (${f.reason})`).join(" · ")}
          </p>
        )}
        {inputError !== null && (
          <p className="mb-4 rounded-xl bg-panel px-4 py-2 text-xs text-text-2">
            <span className="font-bold text-text-1">INPUT ERROR</span> {inputError}
          </p>
        )}
        {output !== null && (
          <div
            ref={mainRef}
            className={`flex flex-col gap-6 transition-opacity ${busy ? "opacity-40" : ""}`}
          >
            {view === "dashboard" && selected !== null && (
              <>
                <CityHero
                  location={selected}
                  cityInfo={selectedInfo}
                  eventDate={selectedResults[0]?.market.event_date}
                  consensus={consensus}
                  sigma={sigma}
                  modelHighs={highs}
                />
                <LadderChart results={selectedResults} consensus={consensus} />
                <LadderTable results={selectedResults} consensus={consensus} mismatches={mismatches} />
              </>
            )}
            {view === "verification" && <VerificationView verification={output.verification} />}
            {view === "skill" && <SkillView modelGrades={output.model_grades} cities={cities} />}
          </div>
        )}
      </div>
      {output !== null && (
        <CityRail
          groups={groups}
          cities={cities}
          modelHighs={output.live?.model_highs}
          selected={selected}
          onSelect={(loc) => {
            setSelectedCity(loc);
            setView("dashboard");
          }}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Delete the replaced components and their tests**

```bash
cd /Users/suchitbasineni/Documents/GitHub/EdgeCast/web
rm src/components/CommandBar.tsx src/components/CommandBar.test.tsx
rm src/components/CityCard.tsx src/components/CityCard.test.tsx
rm src/components/AggregateStrip.tsx src/components/AggregateStrip.test.tsx
```

- [ ] **Step 5: Run the full suite and typecheck/build**

Run: `npm test`
Expected: all PASS (App, format, LadderTable, LadderChart, CityHero, CityRail, Sidebar, TopBar, SkillView, VerificationView, api).

Run: `npm run build`
Expected: tsc clean, vite build succeeds.

- [ ] **Step 6: Report task complete for user commit** (no git commands)

---

### Task 11: Visual QA against reference frames

**Files:**
- Modify (only if QA reveals issues): `web/src/theme.css`, any component from Tasks 3–10.

**Interfaces:**
- Consumes: the running app (`uv run edgecast serve` for the API + `npm run dev` in `web/`, or `npm run preview` after build).
- Produces: screenshots + a pass/fail against the checklist below. This task is review + polish only; no new features.

- [ ] **Step 1: Run the app and capture screenshots**

Start the backend (`uv run edgecast serve`) and frontend (`cd web && npm run dev`), open the printed localhost URL, screenshot: (a) dashboard on load, (b) after switching city, (c) Verification view, (d) Model Skill view. If the live backend has no data, note it and QA with whatever states render (SIGNAL LOST styling counts too).

- [ ] **Step 2: Check against the reference frames**

Compare with `frames/f0928218/frame_0001.jpg` and `frame_0750.jpg` (full-UI frames). Checklist:

- [ ] Three-region layout reads like the reference: slim sidebar, wide main, distinct right rail.
- [ ] Lime accent appears in exactly: active nav pill, LIVE badge, REFRESH button, model line + MODEL pill, prob bars, consensus ▸, selected-city ring, wordmark dot. Nothing else lime.
- [ ] Hero number is the dominant element in the main column (like `$48,392.00`).
- [ ] Chart has dashed gridlines, two glowing lines, pill labels riding the line ends, bucket labels underneath.
- [ ] Table rows have breathing room (py-3), hairline separators, rounded chips for edges.
- [ ] Rail city cards look like the reference's asset cards: rounded-2xl, name + station left, number right.
- [ ] Background shows the subtle lime radial glow top-left; panels read as elevated charcoal, not bordered boxes.
- [ ] Entrance motion: sidebar stagger → hero count-up → chart draw-in with pill pop → rows/rail stagger, under ~1.5s total.
- [ ] City switch: quick fade/slide + count-up from previous value.
- [ ] With OS reduced-motion enabled, everything renders instantly with no tweens.

- [ ] **Step 3: Fix small deviations found (spacing, color intensity, timing)**

Make minimal edits only; re-run `npm test` after any component change.
Expected: all PASS.

- [ ] **Step 4: Final full verification**

```bash
cd /Users/suchitbasineni/Documents/GitHub/EdgeCast/web
npm test && npm run build
```

Expected: all tests PASS, build clean. Report screenshots + checklist results to the user for final commit.
