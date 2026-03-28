import { notFound } from "next/navigation";
import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import AdminNav from "@/components/admin/AdminNav";
import { getAnimalWeightData } from "@/lib/server/weight-analytics";
import type { ADGResult, WeightRecord } from "@/lib/server/weight-analytics";

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

// ── Weight & ADG helpers ────────────────────────────────────────────────────

const ADG_BADGE: Record<"good" | "ok" | "poor", { bg: string; text: string; label: string }> = {
  good: { bg: "rgba(74,124,89,0.12)",   text: "#2D6A4F", label: "Good (>0.9 kg/day)"  },
  ok:   { bg: "rgba(180,110,20,0.12)",  text: "#8B6914", label: "OK (0.7–0.9 kg/day)" },
  poor: { bg: "rgba(192,87,76,0.12)",   text: "#8B3A3A", label: "Poor (<0.7 kg/day)"  },
};

function WeightTab({ weightData }: { weightData: ADGResult }) {
  const { latestWeight, adg, adgTrend, records } = weightData;
  const reversedRecords = [...records].reverse();

  return (
    <div
      className="rounded-2xl border p-5 space-y-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
        Weight & ADG
      </h2>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded-xl p-4"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-xs mb-1" style={{ color: "#9C8E7A" }}>Latest Weight</p>
          <p className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
            {latestWeight !== null ? `${latestWeight.toFixed(1)} kg` : "—"}
          </p>
        </div>
        <div
          className="rounded-xl p-4"
          style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
        >
          <p className="text-xs mb-1" style={{ color: "#9C8E7A" }}>ADG (last interval)</p>
          {adg !== null && adgTrend !== null ? (
            <div className="space-y-1">
              <p className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
                {adg >= 0 ? "+" : ""}{adg.toFixed(2)} kg/day
              </p>
              <span
                className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: ADG_BADGE[adgTrend].bg, color: ADG_BADGE[adgTrend].text }}
              >
                {ADG_BADGE[adgTrend].label}
              </span>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#9C8E7A" }}>
              {records.length === 0 ? "No data" : "Need 2+ readings"}
            </p>
          )}
        </div>
      </div>

      {/* History table or empty state */}
      {records.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl"
          style={{ background: "#FAFAF8", border: "1px dashed #E0D5C8" }}
        >
          <p className="text-sm font-medium" style={{ color: "#9C8E7A" }}>No weight recordings yet.</p>
          <p className="text-xs text-center max-w-xs" style={{ color: "#9C8E7A" }}>
            Weighing sessions are recorded in the Logger. Once recorded they will appear here.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#9C8E7A" }}>
            History ({records.length} sessions)
          </p>
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "#F5F0EA", borderBottom: "1px solid #E0D5C8" }}>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Date</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Weight (kg)</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>ADG vs prev</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "#9C8E7A" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {reversedRecords.map((rec: WeightRecord, idx: number) => {
                  // Find the previous record (chronologically) in the original sorted array
                  const originalIdx = records.findIndex((r) => r.id === rec.id);
                  const prevRec = originalIdx > 0 ? records[originalIdx - 1] : null;
                  let rowAdg: number | null = null;
                  if (prevRec) {
                    const days =
                      (rec.observedAt.getTime() - prevRec.observedAt.getTime()) /
                      (1000 * 60 * 60 * 24);
                    rowAdg = days > 0 ? (rec.weightKg - prevRec.weightKg) / days : null;
                  }
                  const adgColor =
                    rowAdg === null
                      ? "#9C8E7A"
                      : rowAdg > 0.9
                      ? "#2D6A4F"
                      : rowAdg >= 0.7
                      ? "#8B6914"
                      : "#8B3A3A";

                  return (
                    <tr
                      key={rec.id}
                      style={{
                        borderBottom: idx < reversedRecords.length - 1 ? "1px solid #E0D5C8" : "none",
                        background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
                      }}
                    >
                      <td className="px-3 py-2.5 font-mono" style={{ color: "#1C1815" }}>
                        {new Date(rec.observedAt).toLocaleDateString("en-ZA")}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold font-mono" style={{ color: "#1C1815" }}>
                        {rec.weightKg.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ color: adgColor }}>
                        {rowAdg !== null
                          ? `${rowAdg >= 0 ? "+" : ""}${rowAdg.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "#9C8E7A" }}>
                        {rec.notes ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

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

  const [observations, camp, weightData] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId: id },
      orderBy: { observedAt: "desc" },
      take: 200,
    }),
    prisma.camp.findFirst({ where: { campId: animal.currentCamp } }),
    getAnimalWeightData(prisma, id),
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
          <WeightTab weightData={weightData} />
        )}
      </main>
    </div>
  );
}
