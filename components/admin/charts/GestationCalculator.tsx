"use client";

// components/admin/charts/GestationCalculator.tsx
// Phase J5c — Gestation calculator.
//
// Source: memory/research-phase-j-notifications.md §E point 4.
// Uses the breed-level table in lib/species/gestation.ts. Species-aware copy
// (Calving / Lambing / Fawning) pulled from app/[farmSlug]/admin/reproduction/copy.ts
// so the result banner reads correctly across cattle/sheep/game tenants.

import { useMemo, useState } from "react";
import {
  GESTATION_TABLE,
  getGestationDays,
  type GestationBreed,
  type GestationEntry,
  type GestationSpecies,
} from "@/lib/species/gestation";
import type { ReproCopy } from "@/app/[farmSlug]/admin/reproduction/copy";

interface Props {
  /** Species-aware copy from the reproduction page. */
  copy: ReproCopy;
  /**
   * Initial breed selection — defaults to a sensible per-species fallback. Parent
   * can override (e.g. "sheep_dohne" for a sheep-mode tenant).
   */
  defaultBreed?: GestationBreed;
}

const SPECIES_LABELS: Record<GestationSpecies, string> = {
  cattle: "Cattle",
  sheep: "Sheep",
  goat: "Goats",
  pig: "Pigs",
  game: "Game",
};

// Window width per research (§E): ±7 days on either side of the expected date.
const WINDOW_DAYS = 7;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Compute earliest / latest expected birth dates given a mating date and breed.
 * Pure helper so it can be unit-tested without rendering the component.
 */
export function expectedBirthWindow(
  matingDate: Date,
  breed: GestationBreed,
  windowDays: number = WINDOW_DAYS,
): { earliest: Date; latest: Date; gestationDays: number } {
  const gestationDays = getGestationDays(breed);
  const centre = addDays(matingDate, gestationDays);
  return {
    earliest: addDays(centre, -windowDays),
    latest: addDays(centre, windowDays),
    gestationDays,
  };
}

/** Group entries by species for the <select> dropdown. */
function groupEntries(): Array<{ species: GestationSpecies; entries: GestationEntry[] }> {
  const grouped = new Map<GestationSpecies, GestationEntry[]>();
  for (const entry of Object.values(GESTATION_TABLE)) {
    const list = grouped.get(entry.species) ?? [];
    list.push(entry);
    grouped.set(entry.species, list);
  }
  const order: GestationSpecies[] = ["cattle", "sheep", "goat", "pig", "game"];
  return order
    .filter((s) => grouped.has(s))
    .map((species) => ({ species, entries: (grouped.get(species) ?? []).slice() }));
}

export default function GestationCalculator({ copy, defaultBreed = "cattle_bonsmara" }: Props) {
  const [matingDate, setMatingDate] = useState<string>("");
  const [breed, setBreed] = useState<GestationBreed>(defaultBreed);

  const groups = useMemo(() => groupEntries(), []);

  const result = useMemo(() => {
    if (!matingDate) return null;
    const mating = new Date(matingDate);
    if (Number.isNaN(mating.getTime())) return null;
    return expectedBirthWindow(mating, breed);
  }, [matingDate, breed]);

  const selectedEntry = GESTATION_TABLE[breed];

  return (
    <div
      className="rounded-2xl border"
      style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
    >
      <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
        <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
          Gestation Calculator
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          Pick a mating or confirmed conception date and the dam&apos;s breed — we&apos;ll compute the
          expected {copy.birthEventLower} window (±{WINDOW_DAYS}d).
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="gc-mating-date"
              className="text-xs font-medium"
              style={{ color: "#6B5C4E" }}
            >
              Mating / conception date
            </label>
            <input
              id="gc-mating-date"
              type="date"
              value={matingDate}
              onChange={(e) => setMatingDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              style={{ borderColor: "#E0D5C8", color: "#1C1815" }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="gc-breed"
              className="text-xs font-medium"
              style={{ color: "#6B5C4E" }}
            >
              Breed
            </label>
            <select
              id="gc-breed"
              value={breed}
              onChange={(e) => setBreed(e.target.value as GestationBreed)}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              style={{ borderColor: "#E0D5C8", color: "#1C1815" }}
            >
              {groups.map(({ species, entries }) => (
                <optgroup key={species} label={SPECIES_LABELS[species]}>
                  {entries.map((entry) => (
                    <option key={entry.breed} value={entry.breed}>
                      {entry.label} — {entry.days}d
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {result !== null ? (
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(74,124,89,0.06)", border: "1px solid rgba(74,124,89,0.2)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Expected {copy.birthEvent}: {formatDate(result.earliest)} – {formatDate(result.latest)}
            </p>
            <p className="text-xs mt-1" style={{ color: "#6B5C4E" }}>
              {selectedEntry.label} · {result.gestationDays} day gestation · ±{WINDOW_DAYS}d window
            </p>
            {selectedEntry.source && (
              <p className="text-[10px] mt-1" style={{ color: "#9C8E7A" }}>
                Source:{" "}
                <a
                  href={selectedEntry.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "#8B6914" }}
                >
                  citation
                </a>
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-xl p-4"
            style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9C8E7A" }}>
              Breed reference
            </p>
            <p className="text-xs mb-3" style={{ color: "#6B5C4E" }}>
              Enter a date above to compute the window. Gestation days per breed (hover a row for source):
            </p>
            <div className="space-y-3">
              {groups.map(({ species, entries }) => (
                <div key={species}>
                  <p
                    className="text-[11px] font-semibold uppercase tracking-wide mb-1"
                    style={{ color: "#9C8E7A" }}
                  >
                    {SPECIES_LABELS[species]}
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {entries.map((entry) => (
                      <li
                        key={entry.breed}
                        className="flex justify-between text-xs"
                        title={entry.source}
                      >
                        <span style={{ color: "#1C1815" }}>{entry.label}</span>
                        <span className="font-mono tabular-nums" style={{ color: "#6B5C4E" }}>
                          {entry.days}d
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
