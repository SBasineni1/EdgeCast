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
  expect(screen.getByText(/Bergstrom Intl · Jul 04/)).toBeInTheDocument();
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("96.2°");
  expect(screen.getByText(/σ 1\.8°/)).toBeInTheDocument();
});

it("lists per-model highs with deltas vs consensus", () => {
  render(<CityHero {...props} />);
  const models = screen.getByTestId("hero-models");
  expect(models).toHaveTextContent("NBM");
  expect(models).toHaveTextContent("96.4°");
  expect(models).toHaveTextContent("+0.2°");
  expect(models).toHaveTextContent("HRRR");
  expect(models).toHaveTextContent("+1.8°");
  expect(models).toHaveTextContent("GFS");
  expect(models).toHaveTextContent("+6.0°");
});

it("shows a below-consensus model as a neutral signed value", () => {
  render(
    <CityHero
      {...props}
      modelHighs={{ ncep_nbm_conus: 94.1, gfs_hrrr: null, gfs_global: null, consensus: 96.2 }}
    />,
  );
  expect(screen.getByTestId("hero-models")).toHaveTextContent("−2.1°");
});

it("shows an em dash without consensus", () => {
  render(<CityHero {...props} consensus={null} sigma={null} modelHighs={undefined} />);
  expect(screen.getByTestId("hero-temp")).toHaveTextContent("—");
  expect(screen.queryByTestId("hero-models")).toBeNull();
});
