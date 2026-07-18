import { render, screen } from "@testing-library/react";
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
