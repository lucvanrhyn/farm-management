import Link from "next/link";
import { getAnimalById, getCampById, getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import { CALVING_RECORDS, TREATMENTS, OBSERVATIONS } from "@/lib/dummy-data";

export default async function AnimalProfilePage({
  params,
}: {
  params: Promise<{ animalId: string }>;
}) {
  const { animalId } = await params;
  const animal = getAnimalById(animalId);
  const camp = animal ? getCampById(animal.current_camp) : undefined;
  const calvings = CALVING_RECORDS.filter((r) => r.mother_id === animalId || r.calf_id === animalId);
  const treatments = TREATMENTS.filter((t) => t.animal_id === animalId);
  const observations = OBSERVATIONS.filter((o) => o.animal_id === animalId);

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
        <Link href={`/dashboard/camp/${animal.current_camp}`} className="px-3 py-1.5 rounded-lg text-sm" style={{ background: "#334155", color: muted }}>
          ← {animal.current_camp}
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-white text-xl">{animal.animal_id}</span>
          <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${getCategoryChipColor(animal.category)}`}>
            {getCategoryLabel(animal.category)}
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
              ["Ouderdom", getAnimalAge(animal.date_of_birth)],
              ["Geboortedatum", animal.date_of_birth ?? "Onbekend"],
              ["Huidige kamp", camp?.camp_name ?? animal.current_camp],
              ["Status", animal.status],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs mb-0.5" style={{ color: muted }}>{label}</p>
                <p className="font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Calving */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Kalwings ({calvings.length})</h2>
          {calvings.length === 0 ? (
            <p className="text-sm" style={{ color: muted }}>Geen kalwings aangeteken nie.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {calvings.map((c) => (
                <div key={c.calving_id} className="rounded-xl p-3" style={{ background: "#0f172a" }}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{c.timestamp.split("T")[0]}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.calf_alive ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
                      {c.calf_alive ? "Lewend" : "Doodgebore"}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: muted }}>Kalf {c.calf_id} · {c.calf_sex === "Male" ? "Bul" : "Vers"} · {c.ease_of_birth}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Treatments */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Behandelings ({treatments.length})</h2>
          {treatments.length === 0 ? (
            <p className="text-sm" style={{ color: muted }}>Geen behandelings aangeteken nie.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {treatments.map((t) => (
                <div key={t.treatment_id} className="rounded-xl p-3" style={{ background: "#0f172a" }}>
                  <p className="text-sm font-semibold text-white">{t.product_name}</p>
                  <p className="text-xs mt-0.5" style={{ color: muted }}>
                    {t.treatment_type} · {t.dosage ?? "—"} · {t.timestamp.split("T")[0]}
                  </p>
                  {t.withdrawal_clear_date && (
                    <p className="text-xs mt-0.5" style={{ color: "#fbbf24" }}>
                      Onthouding tot: {t.withdrawal_clear_date}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Observations */}
        <div className="rounded-2xl p-5" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="text-sm font-semibold text-white mb-4">Waarnemings ({observations.length})</h2>
          {observations.length === 0 ? (
            <p className="text-sm" style={{ color: muted }}>Geen waarnemings aangeteken nie.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {observations.map((o) => {
                const details = o.details ? (() => { try { return JSON.parse(o.details!); } catch { return {}; } })() : {};
                return (
                  <div key={o.observation_id} className="rounded-xl p-3" style={{ background: "#0f172a" }}>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-semibold text-white capitalize">{o.type.replace("_", " ")}</span>
                      <span className="text-xs" style={{ color: muted }}>{o.timestamp.split("T")[0]}</span>
                    </div>
                    {details.symptoms && (
                      <p className="text-xs" style={{ color: muted }}>
                        {Array.isArray(details.symptoms) ? details.symptoms.join(", ") : details.symptoms}
                      </p>
                    )}
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
