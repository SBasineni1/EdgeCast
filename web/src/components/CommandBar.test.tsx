import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandBar } from "./CommandBar";

const props = {
  updatedAt: null,
  threshold: 0.05,
  onThreshold: vi.fn(),
  onRefresh: vi.fn(),
  busy: false,
};

it("shows the live indicator with dot and updated stamp", () => {
  render(<CommandBar {...props} updatedAt="2026-07-03T12:04:31+00:00" />);
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  expect(screen.getByTestId("live-dot")).toBeInTheDocument();
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
});

it("help panel opens with FAQ content and closes", () => {
  render(<CommandBar {...props} />);
  expect(screen.queryByTestId("help-panel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "help" }));
  const panel = screen.getByTestId("help-panel");
  expect(panel).toHaveTextContent("RIGHT BUCKET");
  expect(panel).toHaveTextContent("CONSENSUS");
  fireEvent.click(screen.getByRole("button", { name: "close help" }));
  expect(screen.queryByTestId("help-panel")).toBeNull();
});

it("steps the threshold within [0,1]", () => {
  const onThreshold = vi.fn();
  render(<CommandBar {...props} threshold={0.0} onThreshold={onThreshold} />);
  fireEvent.click(screen.getByRole("button", { name: "decrease threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "increase threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.01);
});

it("fires onRefresh and shows busy state", () => {
  const { rerender } = render(<CommandBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /REFRESH/ }));
  expect(props.onRefresh).toHaveBeenCalled();
  rerender(<CommandBar {...props} busy={true} />);
  expect(screen.getByText("ANALYZING…")).toBeInTheDocument();
});
