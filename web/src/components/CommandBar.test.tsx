import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandBar } from "./CommandBar";

const props = {
  files: ["a.json", "b.json"],
  selected: "a.json",
  onSelect: vi.fn(),
  threshold: 0.05,
  onThreshold: vi.fn(),
  onAnalyze: vi.fn(),
  busy: false,
};

it("renders segmented buttons for few files and selects on click", () => {
  render(<CommandBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "b.json" }));
  expect(props.onSelect).toHaveBeenCalledWith("b.json");
});

it("renders a select beyond 4 files", () => {
  render(
    <CommandBar
      {...props}
      files={["a.json", "b.json", "c.json", "d.json", "e.json"]}
    />,
  );
  expect(screen.getByRole("combobox")).toBeInTheDocument();
});

it("steps the threshold within [0,1]", () => {
  const onThreshold = vi.fn();
  render(<CommandBar {...props} threshold={0.0} onThreshold={onThreshold} />);
  fireEvent.click(screen.getByRole("button", { name: "decrease threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "increase threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.01);
});

it("fires onAnalyze and shows busy state", () => {
  const { rerender } = render(<CommandBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /ANALYZE/ }));
  expect(props.onAnalyze).toHaveBeenCalled();
  rerender(<CommandBar {...props} busy={true} />);
  expect(screen.getByText("ANALYZING…")).toBeInTheDocument();
});
