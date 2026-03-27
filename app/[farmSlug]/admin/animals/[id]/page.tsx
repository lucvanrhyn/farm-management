import { notFound } from "next/navigation";
import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview",      label: "Overview" },
  { key: "reproduction",  label: "Reproduction" },
  { key: "health",        label: "Health" },
  { key: "movement",      label: "Movement" },
  { key: "weight",        label: "Weight & ADG" },
] as const;

type TabKey = typeof TABS[number]["key"];

// Colour-coded badge styles per repro event type
const REPRO_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  heat_detection:    { bg: "rgba(180,110,20,0.12)",  text: "#8B6914", label: "In Heat"   },
  insemination:      { bg: "rgba(59,130,246,0.12)",  text: "#1D4ED8", label: "AI"        },
  pregnancy_scan:    { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F", label: "Scan"      },
  calving:           { bg: "rgba(13,148,136,0.12)",  text: "#0F766E", label: "Calving"   },
};

function parseDetails(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function reproBadgeLabel(type: string, details: Record<string, unknown>): string {
  if (type === "pregnancy_scan") {
    const r = details.result as string | undefined;
    if (r === "pregnant") return "Scan — Pregnant";
    if (r === "empty")    return "Scan — Empty";
    if (r === "uncertain") return "Scan — Uncertain";
    return "Scan";
  }
  if (type === "calving") {
    const s = details.calf_status as string | undefined;
    return s === "stillborn" ? "Calving — Stillborn" : "Calving — Live";
  }
  return REPRO_BADGE[type]?.label ?? type.replace(/_/g, " ");
}

function reproBadgeStyle(type: string, details: Record<string, unknown>): { bg: string; text: string } {
  if (type === "pregnancy_scan") {
    const r = details.result as string | undefined;
    if (r === "pregnant") return { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F" };
    if (r === "empty")    return { bg: "rgba(192,87,76,0.12)",   text: "#8B3A3A" };
    return { bg: "rgba(180,110,20,0.12)", text: "#8B6914" };
  }
  if (type === "calving") {
    const s = details.calf_status as string | undefined;
    return s === "stillborn"
      ? { bg: "rgba(192,87,76,0.12)", text: "#8B3A3A" }
      : { bg: "rgba(13,148,136,0.12)", text: "#0F766E" };
  }
  return REPRO_BADGE[type] ?? { bg: "rgba(156,142,122,0.12)", text: "#9C8E7A" };
}

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { farmSlug, id } = await params;
  const { tab: rawTab } = await searchParams;
  const activeTab: TabKey = (TABS.map((t) => t.key) as string[]).includes(rawTab ?? "")
    ? (rawTab as TabKey)
    : "overview";

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;
  const animal = await prisma.animal.findUnique({ where: { animalId: id } });
  if (!animal) notFound();

  const [observations, camp] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId: id },
      orderBy: { observedAt: "desc" },
      take: 200,
    }),
    prisma.camp.findFirst({ where: { campId: animal.currentCamp } }),
  ]);

  // Partition observations by tab
  const reproObs = observations.filter((o) =>
    ["heat_detection", "insemination", "pregnancy_scan", "calving"].includes(o.type)
  );
  const healthObs = observations.filter((o) =>
    ["health_issue", "treatment"].includes(o.type)
  );
  const movementObs = observations.filter((o) => o.type === "animal_movement");

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-3xl space-y-4">
        {/* Back */}
        <Link
          href={`/${farmSlug}/admin/animals`}
          className="inline-flex items-center gap-1 text-sm"
          style={{ color: "#9C8E7A" }}
        >
          ← Back to Animals
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>{animal.animalId}</h1>
          {animal.name && <span className="text-lg" style={{ color: "#9C8E7A" }}>— {animal.name}</span>}
          <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${getCategoryChipColor(animal.category as AnimalCategory)}`}>
            {getCategoryLabel(animal.category as AnimalCategory)}
          </span>
          {animal.status === "Active" && (
            <div className="ml-auto">
              <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="detail" />
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div
          className="flex gap-0 rounded-xl overflow-hidden border"
          style={{ border: "1px solid #E0D5C8", background: "#FFFFFF" }}
        >
          {TABS.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/${farmSlug}/admin/animals/${id}?tab=${t.key}`}
                className="flex-1 text-center py-2.5 text-xs font-semibold transition-colors"
                style={{
                  background: isActive ? "#1C1815" : "transparent",
                  color: isActive ? "#FAFAF8" : "#9C8E7A",
                  borderRight: "1px solid #E0D5C8",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* ── Tab: Overview ── */}
        {activeTab === "overview" && (
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
              {animal.notes && (
                <div className="col-span-2 md:col-span-3">
                  <p className="text-xs" style={{ color: "#9C8E7A" }}>Notes</p>
                  <p style={{ color: "#1C1815" }}>{animal.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Reproduction ── */}
        {activeTab === "reproduction" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
                Reproductive History ({reproObs.length})
              </h2>
              <Link
                href={`/${farmSlug}/admin/reproduction`}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: "#8B6914" }}
              >
                View Repro Dashboard →
              </Link>
            </div>
            {reproObs.length === 0 ? (
              <p className="text-xs" style={{ color: "#9C8E7A" }}>No reproductive events recorded.</p>
            ) : (
              <ol className="space-y-3">
                {reproObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
                  const style = reproBadgeStyle(obs.type, d);
                  const label = reproBadgeLabel(obs.type, d);
                  return (
                    <li
                      key={obs.id}
                      className="flex items-start gap-3 py-2.5"
                      style={{ borderBottom: "1px solid #E0D5C8" }}
                    >
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                        style={{ background: style.bg, color: style.text }}
                      >
                        {label}
                      </span>
                      <div className="flex-1 min-w-0">
                        {obs.type === "insemination" && (
                          <p className="text-xs" style={{ color: "#1C1815" }}>
                            {d.bull_id ? `Bull: ${d.bull_id}` : d.semen_batch ? `Batch: ${d.semen_batch}` : ""}
                          </p>
                        )}
                        {obs.type === "pregnancy_scan" && d.expected_calving && (
                          <p className="text-xs" style={{ color: "#1C1815" }}>
                            Expected: {String(d.expected_calving).split("T")[0]}
                          </p>
                        )}
                        {obs.type === "calving" && d.calf_tag && (
                          <p className="text-xs" style={{ color: "#1C1815" }}>
                            Calf tag: <span className="font-mono">{String(d.calf_tag)}</span>
                          </p>
                        )}
                        {d.notes && (
                          <p className="text-xs" style={{ color: "#9C8E7A" }}>{String(d.notes)}</p>
                        )}
                        <p className="text-[11px] mt-0.5" style={{ color: "#9C8E7A" }}>
                          {date} · Camp: {obs.campId}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ── Tab: Health ── */}
        {activeTab === "health" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#9C8E7A" }}>
              Health History ({healthObs.length})
            </h2>
            {healthObs.length === 0 ? (
              <p className="text-xs" style={{ color: "#9C8E7A" }}>No health records.</p>
            ) : (
              <ol className="space-y-3">
                {healthObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
                  const isIssue = obs.type === "health_issue";
                  return (
                    <li
                      key={obs.id}
                      className="flex items-start gap-3 py-2.5"
                      style={{ borderBottom: "1px solid #E0D5C8" }}
                    >
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                        style={
                          isIssue
                            ? { background: "rgba(192,87,76,0.12)", color: "#8B3A3A" }
                            : { background: "rgba(59,130,246,0.12)", color: "#1D4ED8" }
                        }
                      >
                        {isIssue ? "Issue" : "Treatment"}
                      </span>
                      <div className="flex-1 min-w-0">
                        {isIssue && Array.isArray(d.symptoms) && (
                          <p className="text-xs font-medium" style={{ color: "#1C1815" }}>
                            {(d.symptoms as string[]).join(", ")}
                          </p>
                        )}
                        {!isIssue && (
                          <p className="text-xs font-medium" style={{ color: "#1C1815" }}>
                            {[d.drug ?? d.product_name, d.dose ?? d.dosage].filter(Boolean).join(" — ")}
                          </p>
                        )}
                        {d.severity && (
                          <p className="text-xs" style={{ color: "#9C8E7A" }}>Severity: {String(d.severity)}</p>
                        )}
                        {d.notes && (
                          <p className="text-xs" style={{ color: "#9C8E7A" }}>{String(d.notes)}</p>
                        )}
                        <p className="text-[11px] mt-0.5" style={{ color: "#9C8E7A" }}>
                          {date} · Camp: {obs.campId}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ── Tab: Movement ── */}
        {activeTab === "movement" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#9C8E7A" }}>
              Movement History ({movementObs.length})
            </h2>
            {movementObs.length === 0 ? (
              <p className="text-xs" style={{ color: "#9C8E7A" }}>No movement records.</p>
            ) : (
              <ol className="space-y-3">
                {movementObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const date = new Date(obs.observedAt).toLocaleDateString("en-ZA");
                  return (
                    <li
                      key={obs.id}
                      className="flex items-center gap-3 py-2.5"
                      style={{ borderBottom: "1px solid #E0D5C8" }}
                    >
                      <span className="text-lg shrink-0">🚚</span>
                      <div className="flex-1">
                        <p className="text-xs font-medium font-mono" style={{ color: "#1C1815" }}>
                          {String(d.from_camp ?? "?")} → {String(d.to_camp ?? "?")}
                        </p>
                        {d.notes && (
                          <p className="text-xs" style={{ color: "#9C8E7A" }}>{String(d.notes)}</p>
                        )}
                        <p className="text-[11px] mt-0.5" style={{ color: "#9C8E7A" }}>{date}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ── Tab: Weight & ADG ── */}
        {activeTab === "weight" && (
          <div
            className="rounded-2xl border p-5 flex flex-col items-center justify-center gap-3 min-h-[180px]"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <span
              className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{ background: "rgba(156,142,122,0.12)", color: "#9C8E7A" }}
            >
              Coming in next update
            </span>
            <p className="text-xs text-center" style={{ color: "#9C8E7A" }}>
              Weight sessions and Average Daily Gain (ADG) will be available once the weighing logger is released.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
