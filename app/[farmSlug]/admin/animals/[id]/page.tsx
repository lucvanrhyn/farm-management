import { notFound } from "next/navigation";
import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

const OBS_ICONS: Record<string, string> = {
  health_issue: "🏥",
  animal_movement: "🚚",
  reproduction: "🐄",
  death: "💀",
  treatment: "💉",
  camp_check: "✅",
  camp_condition: "✅",
};

function getObsSummary(type: string, detailsJson: string): string {
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(detailsJson); } catch { /* ignore */ }

  if (type === "health_issue") {
    return [(d.symptoms as string[] | undefined)?.join(", "), d.severity as string]
      .filter(Boolean).join(" — ");
  }
  if (type === "animal_movement") return `${d.from_camp ?? "?"} → ${d.to_camp ?? "?"}`;
  if (type === "reproduction") return String(d.event ?? "");
  if (type === "treatment") return [d.drug ?? d.product_name, d.dose ?? d.dosage].filter(Boolean).join(", ");
  if (type === "death") return String(d.cause ?? "");
  return "";
}

export default async function AnimalDetailPage({
  params,
}: {
  params: Promise<{ farmSlug: string; id: string }>;
}) {
  const { farmSlug, id } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;
  const animal = await prisma.animal.findUnique({ where: { animalId: id } });
  if (!animal) notFound();

  const observations = await prisma.observation.findMany({
    where: { animalId: id },
    orderBy: { observedAt: "desc" },
    take: 100,
  });

  const camp = await prisma.camp.findFirst({ where: { campId: animal.currentCamp } });

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
    <AdminNav />
    <main className="flex-1 min-w-0 p-8 max-w-3xl space-y-6">
      {/* Back */}
      <Link
        href={`/${farmSlug}/admin/animals`}
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"
      >
        ← Back to Animals
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-stone-900 font-mono">{animal.animalId}</h1>
        {animal.name && <span className="text-stone-500 text-lg">— {animal.name}</span>}
        <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${getCategoryChipColor(animal.category as AnimalCategory)}`}>
          {getCategoryLabel(animal.category as AnimalCategory)}
        </span>
        {animal.status === "Active" && (
          <div className="ml-auto">
            <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="detail" />
          </div>
        )}
      </div>

      {/* Profile card */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-stone-700 mb-4">Identity</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-stone-400">Sex</p>
            <p className="font-semibold text-stone-800">{animal.sex === "Female" ? "Female" : "Male"}</p>
          </div>
          <div>
            <p className="text-xs text-stone-400">Breed</p>
            <p className="font-semibold text-stone-800">{animal.breed}</p>
          </div>
          <div>
            <p className="text-xs text-stone-400">Age</p>
            <p className="font-semibold text-stone-800">{getAnimalAge(animal.dateOfBirth ?? undefined)}</p>
          </div>
          <div>
            <p className="text-xs text-stone-400">Date of Birth</p>
            <p className="font-semibold text-stone-800">{animal.dateOfBirth ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-xs text-stone-400">Current camp</p>
            <Link
              href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
              className="font-semibold text-green-700 hover:underline"
            >
              {camp?.campName ?? animal.currentCamp}
            </Link>
          </div>
          <div>
            <p className="text-xs text-stone-400">Status</p>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
              animal.status === "Active" ? "bg-green-100 text-green-700"
              : animal.status === "Sold" ? "bg-stone-100 text-stone-600"
              : "bg-red-100 text-red-600"
            }`}>
              {animal.status === "Active" ? "Active" : animal.status === "Sold" ? "Sold" : "Deceased"}
            </span>
          </div>
          {animal.motherId && (
            <div>
              <p className="text-xs text-stone-400">Mother</p>
              <Link href={`/${farmSlug}/admin/animals/${animal.motherId}`} className="font-mono font-semibold text-green-700 hover:underline">
                {animal.motherId}
              </Link>
            </div>
          )}
          {animal.fatherId && (
            <div>
              <p className="text-xs text-stone-400">Sire (Bull)</p>
              <Link href={`/${farmSlug}/admin/animals/${animal.fatherId}`} className="font-mono font-semibold text-green-700 hover:underline">
                {animal.fatherId}
              </Link>
            </div>
          )}
          {animal.notes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-xs text-stone-400">Notes</p>
              <p className="text-stone-700">{animal.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-stone-700 mb-4">
          History ({observations.length})
        </h2>
        {observations.length === 0 ? (
          <p className="text-sm text-stone-400">No history records.</p>
        ) : (
          <ol className="space-y-4">
            {observations.map((obs) => {
              const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
              const summary = getObsSummary(obs.type, obs.details);
              return (
                <li key={obs.id} className="flex gap-3 text-sm">
                  <span className="text-xl leading-none mt-0.5">{OBS_ICONS[obs.type] ?? "📋"}</span>
                  <div>
                    <p className="font-semibold text-stone-800 capitalize">{obs.type.replace(/_/g, " ")}</p>
                    {summary && <p className="text-stone-500">{summary}</p>}
                    <p className="text-xs text-stone-400 mt-0.5">
                      {date} · Camp: {obs.campId} · {obs.loggedBy ?? "unknown"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
    </div>
  );
}
