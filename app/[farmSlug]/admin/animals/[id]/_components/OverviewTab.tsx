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
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#9C8E7A" }}>Identity</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Sex</p>
          <p className="font-semibold" style={{ color: "#1C1815" }}>{animal.sex === "Female" ? "Female" : "Male"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Breed</p>
          <p className="font-semibold" style={{ color: "#1C1815" }}>{animal.breed}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Age</p>
          <p className="font-semibold" style={{ color: "#1C1815" }}>{getAnimalAge(animal.dateOfBirth ?? undefined)}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Date of Birth</p>
          <p className="font-semibold" style={{ color: "#1C1815" }}>{animal.dateOfBirth ?? "Unknown"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Current Camp</p>
          <Link
            href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
            className="font-semibold hover:underline"
            style={{ color: "#4A7C59" }}
          >
            {camp?.campName ?? animal.currentCamp}
          </Link>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#9C8E7A" }}>Status</p>
          <span
            className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              background: animal.status === "Active" ? "rgba(74,124,89,0.12)" : "rgba(156,142,122,0.12)",
              color: animal.status === "Active" ? "#4A7C59" : "#9C8E7A",
            }}
          >
            {animal.status}
          </span>
        </div>
        {animal.motherId && (
          <div>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>Mother</p>
            <Link href={`/${farmSlug}/admin/animals/${animal.motherId}`} className="font-mono font-semibold hover:underline" style={{ color: "#4A7C59" }}>
              {animal.motherId}
            </Link>
          </div>
        )}
        {animal.fatherId && (
          <div>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>Sire (Bull)</p>
            <Link href={`/${farmSlug}/admin/animals/${animal.fatherId}`} className="font-mono font-semibold hover:underline" style={{ color: "#4A7C59" }}>
              {animal.fatherId}
            </Link>
          </div>
        )}
        {animal.registrationNumber && (
          <div className="col-span-2 md:col-span-3">
            <p className="text-xs" style={{ color: "#9C8E7A" }}>Studbook Nr</p>
            <p className="font-mono" style={{ color: "#1C1815" }}>{animal.registrationNumber}</p>
          </div>
        )}
        {animal.tagNumber && (
          <div>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>Tag Nr</p>
            <p className="font-mono" style={{ color: "#1C1815" }}>{animal.tagNumber}</p>
          </div>
        )}
        {animal.brandSequence && (
          <div>
            <p className="text-xs" style={{ color: "#9C8E7A" }}>Brand Sequence</p>
            <p className="font-mono" style={{ color: "#1C1815" }}>{animal.brandSequence}</p>
          </div>
        )}
      </div>
    </div>
  );
}
