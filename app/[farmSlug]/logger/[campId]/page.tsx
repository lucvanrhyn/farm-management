"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import AnimalChecklist from "@/components/logger/AnimalChecklist";
import HealthIssueForm from "@/components/logger/HealthIssueForm";
import MovementForm from "@/components/logger/MovementForm";
import CalvingForm from "@/components/logger/CalvingForm";
import CampConditionForm from "@/components/logger/CampConditionForm";
import ReproductionForm, { type ReproSubmitData } from "@/components/logger/ReproductionForm";
import { getGrazingDot, getGrazingTailwindBg } from "@/lib/utils";
import type { Camp } from "@/lib/types";
import { getAnimalsByCampCached, queueObservation, queueAnimalCreate, updateCampCondition, updateAnimalCamp, updateAnimalStatus } from "@/lib/offline-store";
import { useOffline } from "@/components/logger/OfflineProvider";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Animal, AnimalSex, EaseOfBirth, GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";

type ModalType = "health" | "movement" | "calving" | "death" | "reproduction" | "condition" | null;

export default function CampInspectionPage({
  params,
}: {
  params: Promise<{ farmSlug: string; campId: string }>;
}) {
  const { farmSlug, campId } = use(params);
  const decodedId = decodeURIComponent(campId);
  const loggerRoot = `/${farmSlug}/logger`;

  const router = useRouter();
  const { data: session } = useSession();
  const { isOnline, refreshPendingCount, refreshCampsState, camps, campsLoaded, syncNow } = useOffline();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>("");
  const [allNormalDone, setAllNormalDone] = useState(false);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [flaggedAnimalIds, setFlaggedAnimalIds] = useState<Set<string>>(new Set());

  const camp = camps.find((c) => c.camp_id === decodedId);
  // camps in IndexedDB may carry merged condition fields (grazing_quality etc.) from updateCampCondition
  const campWithCondition = camp as (Camp & { grazing_quality?: string }) | undefined;
  const stats = { total: animals.length };

  // Load animals from IndexedDB
  useEffect(() => {
    getAnimalsByCampCached(decodedId).then(setAnimals);
  }, [decodedId]);

  function handleFlag(animalId: string, type: Exclude<ModalType, "condition" | null>) {
    setSelectedAnimalId(animalId);
    setActiveModal(type);
  }

  function markAnimalFlagged(animalId: string) {
    setFlaggedAnimalIds((prev) => new Set(prev).add(animalId));
  }

  async function handleCompleteVisit() {
    const now = new Date().toISOString();
    const loggedBy = session?.user?.name ?? "Logger";
    const status = flaggedAnimalIds.size > 0 ? "flagged" : "normal";
    await queueObservation({
      type: "camp_check",
      camp_id: decodedId,
      details: JSON.stringify({ status, logged_by: loggedBy }),
      created_at: now,
      synced_at: null,
      sync_status: "pending",
    });
    await updateCampCondition(decodedId, { last_inspected_at: now, last_inspected_by: loggedBy });
    await refreshCampsState();
    refreshPendingCount();
    if (isOnline) syncNow();
    setAllNormalDone(true);
    setActiveModal("condition");
  }

  async function handleHealthSubmit(data: { symptoms: string[]; severity: string; notes: string }) {
    await queueObservation({
      type: "health_issue",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify(data),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleMovementSubmit(data: { animalId: string; sourceCampId: string; destCampId: string }) {
    await queueObservation({
      type: "animal_movement",
      camp_id: decodedId,
      animal_id: data.animalId,
      details: JSON.stringify(data),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    await updateAnimalCamp(data.animalId, data.destCampId);
    if (navigator.onLine) {
      fetch(`/api/animals/${data.animalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCamp: data.destCampId }),
      }).catch(() => {/* will sync later */});
    }
    markAnimalFlagged(data.animalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
    // Refresh animal list so moved animal disappears
    getAnimalsByCampCached(decodedId).then(setAnimals);
  }

  async function handleCalvingSubmit(data: {
    animalId: string;
    campId: string;
    calfAnimalId: string;
    calfName: string;
    calfSex: AnimalSex;
    calfAlive: boolean;
    easeOfBirth: EaseOfBirth;
    fatherId: string | null;
    dateOfBirth: string;
    breed: string;
    category: string;
    notes: string;
  }) {
    const now = new Date().toISOString();

    // Queue the calving observation (offline-safe)
    await queueObservation({
      type: "reproduction",
      camp_id: decodedId,
      animal_id: data.animalId,
      details: JSON.stringify(data),
      created_at: now,
      synced_at: null,
      sync_status: "pending",
    });

    // Create the new calf animal record if alive
    if (data.calfAlive) {
      const calfPayload = {
        animalId: data.calfAnimalId,
        name: data.calfName || null,
        sex: data.calfSex,
        category: data.category || "Calf",
        currentCamp: decodedId,
        motherId: data.animalId,
        fatherId: data.fatherId || null,
        dateOfBirth: data.dateOfBirth,
        dateAdded: data.dateOfBirth,
        breed: data.breed || "Brangus",
        status: "Active",
        notes: data.notes || null,
      };

      if (isOnline) {
        // Attempt immediate POST — fall back to queue on failure
        try {
          const res = await fetch("/api/animals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(calfPayload),
          });
          if (!res.ok) throw new Error("POST failed");
        } catch {
          await queueAnimalCreate({
            animal_id: data.calfAnimalId,
            name: data.calfName || undefined,
            sex: data.calfSex,
            category: data.category || "Calf",
            current_camp: decodedId,
            mother_id: data.animalId,
            date_added: data.dateOfBirth,
            sync_status: "pending",
          });
        }
      } else {
        // Offline — queue for later sync
        await queueAnimalCreate({
          animal_id: data.calfAnimalId,
          name: data.calfName || undefined,
          sex: data.calfSex,
          category: data.category || "Calf",
          current_camp: decodedId,
          mother_id: data.animalId,
          date_added: data.dateOfBirth,
          sync_status: "pending",
        });
      }
    }

    markAnimalFlagged(data.animalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleDeathSubmit(cause: string) {
    await queueObservation({
      type: "death",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify({ cause }),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    await updateAnimalStatus(selectedAnimalId, "Deceased");
    if (navigator.onLine) {
      fetch(`/api/animals/${selectedAnimalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Deceased", deceasedAt: new Date().toISOString() }),
      }).catch(() => {/* will sync later */});
    }
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
    // Refresh animal list so deceased animal is removed from active list
    getAnimalsByCampCached(decodedId).then(setAnimals);
  }

  async function handleReproSubmit(data: ReproSubmitData) {
    await queueObservation({
      type: data.type,
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify(data.details),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleConditionSubmit(data: {
    campId: string;
    grazing: GrazingQuality;
    water: WaterStatus;
    fence: FenceStatus;
    notes: string;
  }) {
    const now = new Date().toISOString();
    const loggedBy = session?.user?.name ?? "Logger";
    await queueObservation({
      type: "camp_condition",
      camp_id: decodedId,
      details: JSON.stringify({ ...data, logged_by: loggedBy }),
      created_at: now,
      synced_at: null,
      sync_status: "pending",
    });
    await updateCampCondition(decodedId, {
      grazing_quality: data.grazing,
      water_status: data.water,
      fence_status: data.fence,
      last_inspected_at: now,
      last_inspected_by: loggedBy,
    });
    await refreshCampsState();
    refreshPendingCount();
    if (isOnline) syncNow();
    router.push(loggerRoot);
  }

  if (!campsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: '#D2B48C' }}>Loading…</p>
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: '#D2B48C' }}>Camp not found: {decodedId}</p>
      </div>
    );
  }

  const grazingQuality = campWithCondition?.grazing_quality ?? "Fair";
  const grazingDot = getGrazingDot(grazingQuality);
  const grazingBadge = getGrazingTailwindBg(grazingQuality);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky header */}
      <div
        className="text-white sticky top-0 z-10"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(92, 61, 46, 0.5)',
          boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <Link
            href={loggerRoot}
            className="w-10 h-10 flex items-center justify-center rounded-full text-lg shrink-0"
            style={{ backgroundColor: 'rgba(92, 61, 46, 0.6)', color: '#D2B48C' }}
          >
            ←
          </Link>
          <div className="flex-1 min-w-0">
            <h1
              className="text-lg font-bold truncate"
              style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
            >
              Camp {camp.camp_name}
            </h1>
            <p className="text-xs" style={{ color: '#D2B48C' }}>
              {stats.total} animals · {camp.water_source ?? "water"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${grazingDot}`} />
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${grazingBadge}`}>
              {grazingQuality}
            </span>
          </div>
        </div>
      </div>

      {/* Sticky "All Normal" button */}
      <div
        className="sticky top-[72px] z-10 px-4 pt-3 pb-2"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {allNormalDone ? (
          <div
            className="w-full font-bold py-5 rounded-3xl text-base text-center"
            style={{ backgroundColor: 'rgba(44, 78, 44, 0.9)', color: '#A8D87A', border: '1px solid rgba(80, 140, 60, 0.4)' }}
          >
            ✓ Visit recorded
          </div>
        ) : (
          <button
            onClick={handleCompleteVisit}
            className="w-full font-bold py-5 rounded-3xl text-base transition-all flex items-center justify-center gap-3 active:scale-95"
            style={{
              backgroundColor: '#B87333',
              color: '#F5F0E8',
              boxShadow: '0 4px 20px rgba(184, 115, 51, 0.4)',
            }}
          >
            <span className="text-xl">✓</span>
            <span>
              {flaggedAnimalIds.size > 0
                ? `Done — ${flaggedAnimalIds.size} animal${flaggedAnimalIds.size > 1 ? 's' : ''} flagged`
                : 'All Normal — Camp Good'}
            </span>
          </button>
        )}
      </div>

      {/* Animal list */}
      <div
        className="flex-1 mt-3 mx-3 mb-3 rounded-2xl overflow-hidden"
        style={{
          backgroundColor: 'rgba(44, 21, 8, 0.65)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(139, 105, 20, 0.2)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(92, 61, 46, 0.35)' }}
        >
          <p className="text-sm font-semibold" style={{ color: '#F5F0E8' }}>
            Animals in camp ({stats.total})
          </p>
          <p className="text-xs" style={{ color: 'rgba(210, 180, 140, 0.6)' }}>
            Tap icon to report
          </p>
        </div>
        <AnimalChecklist campId={decodedId} onFlag={handleFlag} animals={animals} flaggedIds={flaggedAnimalIds} />
      </div>

      {/* Camp condition button — sticky at bottom */}
      <div
        className="sticky bottom-0 px-4 py-3"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(92, 61, 46, 0.4)',
        }}
      >
        <button
          onClick={() => setActiveModal("condition")}
          className="w-full font-semibold py-3.5 rounded-2xl text-sm transition-all flex items-center justify-center gap-2 active:scale-95"
          style={{
            backgroundColor: 'rgba(92, 61, 46, 0.6)',
            color: '#F5F0E8',
            border: '1px solid rgba(139, 105, 20, 0.3)',
          }}
        >
          <span>🌿</span> Report Camp Condition
        </button>
      </div>

      {/* Modals */}
      {activeModal === "health" && (
        <HealthIssueForm
          animalId={selectedAnimalId}
          campId={decodedId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleHealthSubmit}
        />
      )}
      {activeModal === "movement" && (
        <MovementForm
          animalId={selectedAnimalId}
          sourceCampId={decodedId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleMovementSubmit}
        />
      )}
      {activeModal === "calving" && (
        <CalvingForm
          animalId={selectedAnimalId}
          campId={decodedId}
          bulls={animals.filter((a) => a.category === "Bull").map((a) => ({ animalId: a.animal_id, name: a.name ?? null }))}
          onClose={() => setActiveModal(null)}
          onSubmit={handleCalvingSubmit}
        />
      )}
      {activeModal === "death" && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setActiveModal(null)} />
          <div
            className="relative rounded-t-3xl p-6 flex flex-col gap-4"
            style={{ backgroundColor: '#1E0F07', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
          >
            <div className="flex justify-center">
              <div
                className="w-10 h-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }}
              />
            </div>
            <h2
              className="font-bold text-lg"
              style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
            >
              Record Death — {selectedAnimalId}
            </h2>
            <p className="text-sm" style={{ color: '#D2B48C' }}>
              Confirm that animal <span className="font-bold" style={{ color: '#F5F0E8' }}>{selectedAnimalId}</span> is deceased?
            </p>
            <div className="flex flex-col gap-2">
              {["Unknown", "Redwater", "Heartwater", "Snake", "Old age", "Birth complications", "Other"].map((cause) => (
                <button
                  key={cause}
                  onClick={() => handleDeathSubmit(cause)}
                  className="w-full py-3.5 rounded-xl text-sm font-medium transition-colors hover:border-[#B87333] hover:text-[#F5F0E8]"
                  style={{
                    backgroundColor: 'rgba(44, 21, 8, 0.5)',
                    border: '1px solid rgba(92, 61, 46, 0.4)',
                    color: '#D2B48C',
                  }}
                >
                  {cause}
                </button>
              ))}
            </div>
            <button
              onClick={() => setActiveModal(null)}
              className="text-sm py-2"
              style={{ color: 'rgba(210, 180, 140, 0.5)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {activeModal === "reproduction" && (
        <ReproductionForm
          animalId={selectedAnimalId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleReproSubmit}
        />
      )}
      {activeModal === "condition" && (
        <CampConditionForm
          campId={decodedId}
          onClose={() => allNormalDone ? router.push(loggerRoot) : setActiveModal(null)}
          onSkip={allNormalDone ? () => router.push(loggerRoot) : undefined}
          onSubmit={handleConditionSubmit}
        />
      )}
    </div>
  );
}
