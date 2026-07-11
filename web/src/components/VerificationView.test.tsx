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
