// app/[farmSlug]/admin/animals/[id]/_components/OverviewTab.tsx
// Identity card on the Overview tab — sex, breed, age, current camp,
// status, optional parents and studbook nr.

import Link from "next/link";
import type { Animal, Camp } from "@prisma/client";
import { getAnimalAge } from "@/lib/utils";

interface OverviewTabProps {
  animal: Animal;
  camp: Camp | null;
  farmSlug: string;
}

export function OverviewTab({ animal, camp, farmSlug }: OverviewTabProps) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: "var(--ft-surface)", border: "1px solid var(--ft-border)" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "var(--ft-subtle)" }}>Identity</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Sex</p>
          <p className="font-semibold" style={{ color: "var(--ft-text)" }}>{animal.sex === "Female" ? "Female" : "Male"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Breed</p>
          <p className="font-semibold" style={{ color: "var(--ft-text)" }}>{animal.breed}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Age</p>
          <p className="font-semibold" style={{ color: "var(--ft-text)" }}>{getAnimalAge(animal.dateOfBirth ?? undefined)}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Date of Birth</p>
          <p className="font-semibold" style={{ color: "var(--ft-text)" }}>{animal.dateOfBirth ?? "Unknown"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Current Camp</p>
          <Link
            href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
            className="font-semibold hover:underline"
            style={{ color: "var(--ft-good)" }}
          >
            {camp?.campName ?? animal.currentCamp}
          </Link>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Status</p>
          <span
            className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              background: animal.status === "Active" ? "rgba(74,124,89,0.12)" : "rgba(156,142,122,0.12)",
              color: animal.status === "Active" ? "var(--ft-good)" : "var(--ft-subtle)",
            }}
          >
            {animal.status}
          </span>
        </div>
        {animal.motherId && (
          <div>
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Mother</p>
            <Link href={`/${farmSlug}/admin/animals/${animal.motherId}`} className="font-mono font-semibold hover:underline" style={{ color: "var(--ft-good)" }}>
              {animal.motherId}
            </Link>
          </div>
        )}
        {animal.fatherId && (
          <div>
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Sire (Bull)</p>
            <Link href={`/${farmSlug}/admin/animals/${animal.fatherId}`} className="font-mono font-semibold hover:underline" style={{ color: "var(--ft-good)" }}>
              {animal.fatherId}
            </Link>
          </div>
        )}
        {animal.registrationNumber && (
          <div className="col-span-2 md:col-span-3">
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Studbook Nr</p>
            <p className="font-mono" style={{ color: "var(--ft-text)" }}>{animal.registrationNumber}</p>
          </div>
        )}
        {animal.tagNumber && (
          <div>
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Tag Nr</p>
            <p className="font-mono" style={{ color: "var(--ft-text)" }}>{animal.tagNumber}</p>
          </div>
        )}
        {animal.brandSequence && (
          <div>
            <p className="text-xs" style={{ color: "var(--ft-subtle)" }}>Brand Sequence</p>
            <p className="font-mono" style={{ color: "var(--ft-text)" }}>{animal.brandSequence}</p>
          </div>
        )}
      </div>
    </div>
  );
}
