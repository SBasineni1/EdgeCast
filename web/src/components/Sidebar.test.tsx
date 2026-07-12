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
  expect(panel).toHaveTextContent("Right bucket");
  expect(panel).toHaveTextContent("Consensus");
  fireEvent.click(screen.getByRole("button", { name: "close help" }));
  expect(screen.queryByTestId("help-panel")).toBeNull();
});
