import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

const props = { updatedAt: null, busy: false, onRefresh: vi.fn() };

it("shows the live indicator with dot and updated stamp", () => {
  render(<TopBar {...props} updatedAt="2026-07-03T12:04:31+00:00" />);
  expect(screen.getByText("Live")).toBeInTheDocument();
  expect(screen.getByTestId("live-dot")).toBeInTheDocument();
  expect(screen.getByText(/Updated/)).toBeInTheDocument();
});

it("fires onRefresh and shows busy state", () => {
  const { rerender } = render(<TopBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
  expect(props.onRefresh).toHaveBeenCalled();
  rerender(<TopBar {...props} busy={true} />);
  expect(screen.getByText("Analyzing…")).toBeInTheDocument();
});
