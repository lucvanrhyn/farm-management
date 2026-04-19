// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import GestationCalculator, {
  expectedBirthWindow,
} from "@/components/admin/charts/GestationCalculator";
import { COPY_BY_MODE } from "@/app/[farmSlug]/admin/reproduction/copy";

describe("GestationCalculator — expectedBirthWindow helper", () => {
  it("computes a ±7d window for Bonsmara cattle (283d gestation)", () => {
    const mating = new Date("2026-01-01T00:00:00Z");
    const { earliest, latest, gestationDays } = expectedBirthWindow(mating, "cattle_bonsmara");
    expect(gestationDays).toBe(283);
    const centre = new Date(mating.getTime() + 283 * 86_400_000);
    const expEarliest = new Date(centre.getTime() - 7 * 86_400_000);
    const expLatest = new Date(centre.getTime() + 7 * 86_400_000);
    expect(earliest.toISOString()).toBe(expEarliest.toISOString());
    expect(latest.toISOString()).toBe(expLatest.toISOString());
  });

  it("computes a ±7d window for Impala (197d gestation)", () => {
    const mating = new Date("2026-01-01T00:00:00Z");
    const { earliest, latest, gestationDays } = expectedBirthWindow(mating, "impala");
    expect(gestationDays).toBe(197);
    const centre = new Date(mating.getTime() + 197 * 86_400_000);
    expect(earliest.toISOString()).toBe(
      new Date(centre.getTime() - 7 * 86_400_000).toISOString(),
    );
    expect(latest.toISOString()).toBe(
      new Date(centre.getTime() + 7 * 86_400_000).toISOString(),
    );
  });

  it("computes a ±7d window for Dohne sheep (147d gestation)", () => {
    const mating = new Date("2026-03-01T00:00:00Z");
    const { earliest, latest, gestationDays } = expectedBirthWindow(mating, "sheep_dohne");
    expect(gestationDays).toBe(147);
    const centre = new Date(mating.getTime() + 147 * 86_400_000);
    expect(earliest.toISOString()).toBe(
      new Date(centre.getTime() - 7 * 86_400_000).toISOString(),
    );
    expect(latest.toISOString()).toBe(
      new Date(centre.getTime() + 7 * 86_400_000).toISOString(),
    );
  });
});

describe("GestationCalculator — UI", () => {
  beforeEach(() => cleanup());

  it("renders the breed reference when no date is picked", () => {
    render(<GestationCalculator copy={COPY_BY_MODE.cattle} />);
    expect(screen.getByText(/Breed reference/i)).toBeTruthy();
    // Bonsmara appears both in the <select> options and the reference list;
    // assert at least one occurrence to prove the reference table rendered.
    expect(screen.getAllByText(/Bonsmara/i).length).toBeGreaterThan(0);
  });

  it("computes and displays the expected birth window when a mating date is entered", () => {
    render(<GestationCalculator copy={COPY_BY_MODE.cattle} defaultBreed="cattle_bonsmara" />);
    const input = screen.getByLabelText(/Mating \/ conception date/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-01-01" } });
    // The banner should read "Expected Calving: …" for cattle mode.
    expect(screen.getByText(/Expected Calving/)).toBeTruthy();
    // Gestation days pill present for Bonsmara (283d).
    expect(screen.getByText(/283 day gestation/)).toBeTruthy();
  });

  it("uses sheep-specific copy when passed sheep mode", () => {
    render(<GestationCalculator copy={COPY_BY_MODE.sheep} defaultBreed="sheep_dohne" />);
    const input = screen.getByLabelText(/Mating \/ conception date/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-03-01" } });
    expect(screen.getByText(/Expected Lambing/)).toBeTruthy();
    expect(screen.getByText(/147 day gestation/)).toBeTruthy();
  });

  it("uses game-specific copy when passed game mode + kudu breed", () => {
    render(<GestationCalculator copy={COPY_BY_MODE.game} defaultBreed="kudu" />);
    const input = screen.getByLabelText(/Mating \/ conception date/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-03-01" } });
    expect(screen.getByText(/Expected Fawning/)).toBeTruthy();
    expect(screen.getByText(/240 day gestation/)).toBeTruthy();
  });
});
