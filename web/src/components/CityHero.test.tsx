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
