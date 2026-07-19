import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { VerificationView } from "./VerificationView";

const base = {
  window_days: 30,
  n_markets: 214,
  n_days: 29,
};

it("renders window stats", () => {
  render(<VerificationView verification={base} />);
  expect(screen.getByText("30D")).toBeInTheDocument();
  expect(screen.getByText("214")).toBeInTheDocument();
  expect(screen.getByText("29/30")).toBeInTheDocument();
  expect(screen.getByText("Awaiting first scored snapshot")).toBeInTheDocument();
});

it("renders empty state without verification data", () => {
  render(<VerificationView verification={null} />);
  expect(screen.getByText(/No verification data yet/)).toBeInTheDocument();
});


it("renders the coverage strip with graded and missing days", () => {
  render(
    <VerificationView
      verification={{
        ...base,
        coverage: [
          { date: "2026-07-01", graded: true },
          { date: "2026-07-02", graded: false },
          { date: "2026-07-03", graded: true },
        ],
      }}
    />,
  );
  expect(screen.getAllByTestId("coverage-day")).toHaveLength(2);
  expect(screen.getAllByTestId("coverage-day-missing")).toHaveLength(1);
  expect(screen.getAllByTestId("coverage-day")[0].className).toContain("bg-coverage");
  expect(screen.getAllByTestId("coverage-day-missing")[0].className).toContain("bg-panel-2");
  expect(screen.getByText(/Ungraded days/)).toBeInTheDocument();
});

it("omits the coverage strip without coverage data", () => {
  render(<VerificationView verification={base} />);
  expect(screen.queryByTestId("coverage-strip")).toBeNull();
});

const snapshotsBase = {
  window_days: 30,
  pending_event_date: "2026-07-13",
  taken_at: "2026-07-12T11:02:00-04:00",
  n_scored: 5,
  n_pending: 1,
  model_hits: 3,
  market_hits: 2,
  days: [
    { event_date: "2026-07-11", n: 3, model_hits: 2, market_hits: 1 },
    { event_date: "2026-07-10", n: 2, model_hits: 1, market_hits: 1 },
  ],
};

it("renders the day-ahead snapshot scorecard", () => {
  render(<VerificationView verification={base} snapshots={snapshotsBase} />);
  expect(screen.getByTestId("snapshot-status")).toHaveTextContent("frozen at 11:02 AM ET");
  expect(screen.getByTestId("skill-lead")).toHaveTextContent("+20.0 pp");
  expect(screen.getByTestId("snapshot-score")).toHaveTextContent("Model 60.0%");
  expect(screen.getByTestId("snapshot-score")).toHaveTextContent("market 40.0%");
  expect(screen.getAllByTestId("snapshot-day")).toHaveLength(2);
  expect(screen.getByText("1 awaiting settlement")).toBeInTheDocument();
});

it("shows the snapshot empty state before anything settles", () => {
  render(
    <VerificationView
      verification={base}
      snapshots={{ ...snapshotsBase, taken_at: null, n_scored: 0, model_hits: 0, market_hits: 0, days: [] }}
    />,
  );
  expect(screen.getByTestId("snapshot-status")).toHaveTextContent("Next capture after 11:00 AM ET");
  expect(screen.getByTestId("snapshot-empty")).toBeInTheDocument();
});

it("omits the snapshot card without snapshot data", () => {
  render(<VerificationView verification={base} />);
  expect(screen.queryByTestId("snapshot-status")).toBeNull();
});

it("renders the active model card with learned-blend provenance", () => {
  render(
    <VerificationView
      verification={base}
      blendModel={{
        id: 3,
        promoted_at: "2026-07-18T09:00:00+00:00",
        train_end_date: "2026-07-15",
        n_rows: 786,
        candidate_mae: 1.5,
        baseline_mae: 1.7,
      }}
    />,
  );
  const card = screen.getByTestId("active-model");
  expect(card).toHaveTextContent("Learned blend");
  expect(card).toHaveTextContent("gbm-v3");
  expect(card).toHaveTextContent("Trained on 786 market-days through Jul 15");
  expect(card).toHaveTextContent("promoted Jul 18");
  expect(screen.getByTestId("active-model-validation")).toHaveTextContent(
    "Validation MAE 1.5° vs 1.7° equal-weight baseline",
  );
});

it("shows the equal-weight fallback when no model is promoted", () => {
  render(<VerificationView verification={base} blendModel={null} />);
  const card = screen.getByTestId("active-model");
  expect(card).toHaveTextContent("Equal-weight blend");
  expect(card).toHaveTextContent(/promotes automatically/);
  expect(screen.queryByTestId("active-model-validation")).toBeNull();
});

const call = (over: object) => ({
  market_id: "M1",
  city: "NYC",
  event_date: "2026-07-17",
  question: "Will the high in NYC be 88-89?",
  comparator: "between",
  threshold: null,
  threshold_low: 88,
  threshold_high: 89,
  model_prob: 0.62,
  market_prob: 0.41,
  edge: 0.21,
  outcome: 1,
  model_right: true,
  brier_delta: 0.18,
  ...over,
});

it("renders edge realization with settled verdicts and pending calls", () => {
  render(
    <VerificationView
      verification={base}
      realization={{
        threshold: 0.05,
        n_settled: 2,
        n_model_right: 1,
        mean_brier_edge: 0.041,
        settled: [
          call({}),
          call({ market_id: "M2", edge: -0.11, model_prob: 0.2, market_prob: 0.31, outcome: 1, model_right: false }),
        ],
        pending: [call({ market_id: "M3", edge: 0.08, outcome: null, model_right: null, brier_delta: null })],
      }}
    />,
  );
  expect(screen.getByTestId("realization-score")).toHaveTextContent("Model right on 1 of 2 settled disagreements · 50%");
  expect(screen.getAllByTestId("edge-call")).toHaveLength(2);
  const verdicts = screen.getAllByTestId("edge-verdict");
  expect(verdicts[0]).toHaveTextContent("Model ✓");
  expect(verdicts[0]).toHaveClass("text-up");
  expect(verdicts[1]).toHaveTextContent("Market ✓");
  expect(verdicts[1]).toHaveClass("text-down");
  expect(screen.getByText("Awaiting settlement")).toBeInTheDocument();
  expect(screen.getAllByTestId("edge-call-pending")).toHaveLength(1);
  expect(screen.getByText("+21.0 pp")).toBeInTheDocument();
});

it("shows the realization empty state and omits the card when null", () => {
  const { rerender } = render(
    <VerificationView
      verification={base}
      realization={{ threshold: 0.05, n_settled: 0, n_model_right: 0, mean_brier_edge: null, settled: [], pending: [] }}
    />,
  );
  expect(screen.getByTestId("realization-empty")).toBeInTheDocument();
  rerender(<VerificationView verification={base} realization={null} />);
  expect(screen.queryByTestId("edge-realization")).toBeNull();
});

it("renders compact bucket labels and collapses long settled lists", () => {
  const settled = Array.from({ length: 20 }, (_, i) =>
    call({ market_id: `S${i}`, edge: 0.06 + i / 100 }),
  );
  render(
    <VerificationView
      verification={base}
      realization={{ threshold: 0.05, n_settled: 20, n_model_right: 12, mean_brier_edge: 0.02, settled, pending: [] }}
    />,
  );
  expect(screen.getAllByText("88–89°").length).toBeGreaterThan(0);
  expect(screen.getAllByTestId("edge-call")).toHaveLength(14);
  const toggle = screen.getByTestId("realization-toggle");
  expect(toggle).toHaveTextContent("Show all 20 settled calls");
  fireEvent.click(toggle);
  expect(screen.getAllByTestId("edge-call")).toHaveLength(20);
  expect(toggle).toHaveTextContent("Show fewer");
});
