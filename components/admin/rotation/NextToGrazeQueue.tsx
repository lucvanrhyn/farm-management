"use client";

// Ranked list of resting-ready camps with one-click mob move.
// Moves are performed directly via the mobs PATCH API (which writes mob_movement
// observations server-side), so OfflineProvider is not required.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import MobMoveModal from "@/components/logger/MobMoveModal";
import type { CampRotationStatus } from "@/lib/server/rotation-engine";
import type { Camp } from "@/lib/types";

interface ApiMob {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
}

interface Props {
  queuedCamps: CampRotationStatus[];
  allCamps: Camp[];
}

export default function NextToGrazeQueue({ queuedCamps, allCamps }: Props) {
  const router = useRouter();

  // Step 1: user clicks a queue entry — show mob picker
  const [destCampId, setDestCampId]   = useState<string | null>(null);
  const [mobs, setMobs]               = useState<ApiMob[]>([]);
  const [loadingMobs, setLoadingMobs] = useState(false);

  // Step 2: user picks a mob — open MobMoveModal
  const [selectedMob, setSelectedMob]   = useState<ApiMob | null>(null);
  const [destCamp, setDestCamp]         = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    if (!destCampId) return;
    setLoadingMobs(true);
    setMobs([]);
    fetch("/api/mobs")
      .then((r) => (r.ok ? r.json() : []))
      .then((all: ApiMob[]) => setMobs(all.filter((m) => m.animal_count > 0)))
      .catch(() => setMobs([]))
      .finally(() => setLoadingMobs(false));
  }, [destCampId]);

  function handleOpenQueue(campId: string) {
    setDestCampId(campId);
    setDestCamp(campId);
    setSelectedMob(null);
    setError(null);
  }

  function handlePickMob(mob: ApiMob) {
    setSelectedMob(mob);
  }

  function handleClose() {
    setDestCampId(null);
    setSelectedMob(null);
    setMobs([]);
    setError(null);
    setIsSubmitting(false);
  }

  async function handleConfirmMove() {
    if (!selectedMob || !destCamp) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${selectedMob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCamp: destCamp }),
      });
      if (!res.ok) {
        setError("Move failed — please try again.");
        setIsSubmitting(false);
        return;
      }
      handleClose();
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setIsSubmitting(false);
    }
  }

  const mobForModal = selectedMob
    ? { id: selectedMob.id, name: selectedMob.name, animal_count: selectedMob.animal_count }
    : null;

  return (
    <>
      <div className="rounded-2xl border overflow-hidden mb-6" style={{ borderColor: "#E0D5C8" }}>
        <div className="px-5 py-3 border-b" style={{ background: "#FAFAF8", borderColor: "#E0D5C8" }}>
          <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Next to Graze
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
            Ranked by days rested — longest first.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#F0EAE0" }}>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Camp</th>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>Days Rested</th>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: "#9C8E7A" }}>Capacity</th>
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: "#9C8E7A" }}>Veld Type</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {queuedCamps.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-sm" style={{ color: "#9C8E7A" }}>
                  No resting-ready camps at the moment.
                </td>
              </tr>
            )}
            {queuedCamps.map((camp, i) => (
              <tr key={camp.campId} className="border-b last:border-0" style={{ borderColor: "#F0EAE0" }}>
                <td className="px-5 py-3 font-medium" style={{ color: "#1C1815" }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
                      style={{ background: "rgba(22,163,74,0.12)", color: "#16a34a" }}
                    >
                      {i + 1}
                    </span>
                    {camp.campName}
                  </div>
                </td>
                <td className="px-5 py-3 tabular-nums" style={{ color: "#4B3D2E" }}>
                  {camp.daysRested != null ? `${camp.daysRested}d` : "—"}
                </td>
                <td className="px-5 py-3 hidden md:table-cell" style={{ color: "#9C8E7A" }}>
                  {camp.capacityLsuDays != null ? `${camp.capacityLsuDays.toFixed(0)} LSU-days` : "—"}
                </td>
                <td className="px-5 py-3 hidden md:table-cell capitalize" style={{ color: "#9C8E7A" }}>
                  {camp.veldType ?? "—"}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => handleOpenQueue(camp.campId)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{
                      background: "rgba(22,163,74,0.1)",
                      color: "#16a34a",
                      border: "1px solid rgba(22,163,74,0.25)",
                    }}
                  >
                    Move mob here →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Step 1: mob picker (shown when a queue entry is clicked, before mob selected) */}
      {destCampId && !selectedMob && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
          <div
            className="relative rounded-t-3xl p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto"
            style={{ backgroundColor: "#1E0F07", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}
          >
            <div className="flex justify-center mb-1">
              <div className="w-10 h-1.5 rounded-full" style={{ backgroundColor: "rgba(139,105,20,0.4)" }} />
            </div>
            <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-display)", color: "#F5F0E8" }}>
              Move mob to{" "}
              {allCamps.find((c) => c.camp_id === destCampId)?.camp_name ?? destCampId}
            </h2>
            <p className="text-sm" style={{ color: "#D2B48C" }}>
              Select which mob to move:
            </p>
            {loadingMobs && (
              <p className="text-sm" style={{ color: "#D2B48C" }}>Loading mobs…</p>
            )}
            {!loadingMobs && mobs.length === 0 && (
              <p className="text-sm" style={{ color: "#D2B48C" }}>
                No mobs with active animals found.
              </p>
            )}
            {mobs.map((mob) => (
              <button
                key={mob.id}
                onClick={() => handlePickMob(mob)}
                className="flex justify-between items-center w-full px-4 py-3 rounded-xl text-left"
                style={{
                  backgroundColor: "rgba(44,21,8,0.5)",
                  border: "1px solid rgba(92,61,46,0.4)",
                  color: "#D2B48C",
                }}
              >
                <span className="font-medium" style={{ color: "#F5F0E8" }}>{mob.name}</span>
                <span className="text-xs" style={{ color: "#C49030" }}>
                  {mob.animal_count} animal{mob.animal_count !== 1 ? "s" : ""}
                </span>
              </button>
            ))}
            <button
              onClick={handleClose}
              className="text-sm py-2"
              style={{ color: "rgba(210,180,140,0.5)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 2: confirm move via MobMoveModal */}
      <MobMoveModal
        isOpen={selectedMob !== null}
        mob={mobForModal}
        camps={allCamps}
        currentCampId={selectedMob?.current_camp ?? ""}
        destCamp={destCamp}
        onDestCampChange={setDestCamp}
        onConfirm={handleConfirmMove}
        onClose={handleClose}
        isSubmitting={isSubmitting}
      />

      {error && (
        <p className="text-sm mt-2 text-center" style={{ color: "#dc2626" }}>
          {error}
        </p>
      )}
    </>
  );
}
