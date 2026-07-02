import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProbBar } from "./ProbBar";

it("renders fill width proportional to value", () => {
  render(<ProbBar label="MARKET" value={0.72} variant="solid" />);
  expect(screen.getByTestId("probbar-fill")).toHaveAttribute("width", "72%");
});

it("clamps out-of-range values into 0..100%", () => {
  render(<ProbBar label="X" value={1.2} variant="solid" />);
  expect(screen.getByTestId("probbar-fill")).toHaveAttribute("width", "100%");
});

it("shows the numeric value to two decimals", () => {
  render(<ProbBar label="MODEL" value={0.8} variant="hatched" />);
  expect(screen.getByText("0.80")).toBeInTheDocument();
});

it("hatched variant fills via pattern, solid via flat color", () => {
  const { container, rerender } = render(
    <ProbBar label="MODEL" value={0.5} variant="hatched" />,
  );
  expect(container.querySelector("pattern")).not.toBeNull();
  expect(screen.getByTestId("probbar-fill").getAttribute("fill")).toMatch(/^url\(#/);
  rerender(<ProbBar label="MARKET" value={0.5} variant="solid" />);
  expect(container.querySelector("pattern")).toBeNull();
  expect(screen.getByTestId("probbar-fill").getAttribute("fill")).toBe(
    "var(--color-text-2)",
  );
});
