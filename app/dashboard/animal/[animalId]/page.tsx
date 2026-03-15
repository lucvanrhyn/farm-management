import Link from "next/link";
import { getCampById, getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import type { AnimalCategory } from "@/lib/types";

export default async function AnimalProfilePage({
  params,
}: {
  params: Promise<{ animalId: string }>;
}) {
  const { animalId } = await params;
  const animal = await prisma.animal.findUnique({ where: { animalId } });
  const camp = animal ? getCampById(animal.currentCamp) : undefined;
  const observations = animal
    ? await prisma.observation.findMany({
        where: { animalId },
        orderBy: { observedAt: "desc" },
        take: 100,
      })
    : [];

  const bg = "#0f172a";
  const surface = "#1e293b";
  const border = "#334155";
  const muted = "#94a3b8";

  if (!animal) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <p style={{ color: muted }}>Dier nie gevind: {animalId}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: bg, color: "#f1f5f9" }}>
      <div className="px-6 py-5 border-b flex items-center gap-4" style={{ borderColor: border, background: surface }}>
        <Link href={`/dashboard/camp/${animal.currentCamp}`} className="px-3 py-1.5 rounded-lg text-sm" style={{ background: "#334155", color: muted }}>
          ← {animal.currentCamp}
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-white text-xl">{animal.animalId}</span>
          <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${getCategoryChipColor(animal.category as AnimalCategory)}`}>
            {getCategoryLabel(animal.category as AnimalCategory)}
          </span>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Identity */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Identiteit</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Geslag", animal.sex === "Female" ? "Vroulik" : "Manlik"],
              ["Ras", animal.breed],
              ["Ouderdom", getAnimalAge(animal.dateOfBirth ?? undefined)],
              ["Geboortedatum", animal.dateOfBirth ?? "Onbekend"],
              ["Huidige kamp", camp?.camp_name ?? animal.currentCamp],
              ["Status", animal.status],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs mb-0.5" style={{ color: muted }}>{label}</p>
                <p className="font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Geskiedenis */}
        <div className="rounded-2xl p-5 md:col-span-1" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Geskiedenis ({observations.length})</h2>
          {observations.length === 0 ? (
            <p className="text-sm" style={{ color: muted }}>Geen geskiedenisinslae nie.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {observations.map((obs) => {
                const date = new Date(obs.observedAt).toLocaleDateString("af-ZA");
                let details: Record<string, unknown> = {};
                try { details = JSON.parse(obs.details); } catch { /* ignore */ }

                const icons: Record<string, string> = {
                  health_issue: "🏥", animal_movement: "🚚", reproduction: "🐄",
                  death: "💀", treatment: "💉", camp_check: "✅", camp_condition: "✅",
                };

                let summary = "";
                if (obs.type === "health_issue") {
                  summary = [(details.symptoms as string[] | undefined)?.join(", "), details.severity as string].filter(Boolean).join(" — ");
                } else if (obs.type === "animal_movement") {
                  summary = `${details.from_camp ?? "?"} → ${details.to_camp ?? "?"}`;
                } else if (obs.type === "reproduction") {
                  summary = String(details.event ?? "");
                } else if (obs.type === "treatment") {
                  summary = [details.drug ?? details.product_name, details.dose ?? details.dosage].filter(Boolean).join(", ");
                } else if (obs.type === "death") {
                  summary = String(details.cause ?? "");
                }

                return (
                  <div key={obs.id} className="rounded-xl p-3 flex gap-3" style={{ background: "#0f172a" }}>
                    <span className="text-base">{icons[obs.type] ?? "📋"}</span>
                    <div>
                      <div className="flex justify-between gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-white capitalize">{obs.type.replace(/_/g, " ")}</span>
                        <span className="text-xs shrink-0" style={{ color: muted }}>{date}</span>
                      </div>
                      {summary && <p className="text-xs" style={{ color: muted }}>{summary}</p>}
                      <p className="text-xs mt-0.5" style={{ color: "rgba(148,163,184,0.55)" }}>{obs.loggedBy ?? "onbekend"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
