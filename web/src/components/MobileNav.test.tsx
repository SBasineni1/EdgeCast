import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MobileNav } from "./MobileNav";

const props = {
  view: "dashboard" as const,
  onView: vi.fn(),
  threshold: 0.05,
  onThreshold: vi.fn(),
};

it("switches views from a nav button", () => {
  const onView = vi.fn();
  render(<MobileNav {...props} onView={onView} />);

  fireEvent.click(screen.getByRole("button", { name: "Verification" }));
  expect(onView).toHaveBeenCalledWith("verification");
});

it("steps the threshold by 0.01", () => {
  const onThreshold = vi.fn();
  render(<MobileNav {...props} onThreshold={onThreshold} />);

  fireEvent.click(screen.getByRole("button", { name: "increase threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.06);
  fireEvent.click(screen.getByRole("button", { name: "decrease threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.04);
});

it("opens help and toggles aria-expanded", () => {
  render(<MobileNav {...props} />);
  const help = screen.getByRole("button", { name: "help" });

  expect(help).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("help-panel")).toBeNull();
  fireEvent.click(help);
  expect(help).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("help-panel")).toBeInTheDocument();
  fireEvent.click(help);
  expect(help).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByTestId("help-panel")).toBeNull();
});
