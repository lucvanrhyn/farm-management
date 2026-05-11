"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import AnimalChecklist from "@/components/logger/AnimalChecklist";

// Modal forms are lazy-loaded: each chunk is only fetched the first time
// the user opens the corresponding modal. Before this split, opening a
// camp page shipped ~200KB of form JS up front (validation, date pickers,
// photo capture, breed-specific repro logic) that most visits never used.
// `{ ssr: false }` because these are pure client-side forms — SSRing them
// would bloat the server render without any hydration benefit.
//
// Type-only imports stay at the top (`type` is erased at runtime and has
// zero bundle cost) so we don't accidentally drag the full module into the
// initial chunk just to reference a type.
import type { ReproSubmitData } from "@/components/logger/ReproductionForm";
const HealthIssueForm = dynamic(() => import("@/components/logger/HealthIssueForm"), { ssr: false });
const MovementForm = dynamic(() => import("@/components/logger/MovementForm"), { ssr: false });
const CalvingForm = dynamic(() => import("@/components/logger/CalvingForm"), { ssr: false });
const CampConditionForm = dynamic(() => import("@/components/logger/CampConditionForm"), { ssr: false });
const WeighingForm = dynamic(() => import("@/components/logger/WeighingForm"), { ssr: false });
const TreatmentForm = dynamic(() => import("@/components/logger/TreatmentForm"), { ssr: false });
const CampCoverLogForm = dynamic(() => import("@/components/logger/CampCoverLogForm"), { ssr: false });
const ReproductionForm = dynamic(() => import("@/components/logger/ReproductionForm"), { ssr: false });
const DeathModal = dynamic(() => import("@/components/logger/DeathModal"), { ssr: false });
const MobMoveModal = dynamic(() => import("@/components/logger/MobMoveModal"), { ssr: false });

import { submitCalvingObservation, submitMobMove, type CalvingData } from "@/lib/logger-actions";
import { getGrazingDot, getGrazingTailwindBg } from "@/lib/utils";
import type { Camp } from "@/lib/types";
import { getAnimalsByCampCached, queueObservation, queuePhoto, queueCoverReading, updateCampCondition, updateAnimalCamp, updateAnimalStatus } from "@/lib/offline-store";
import { useOffline } from "@/components/logger/OfflineProvider";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Animal, GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { campConditionDoneLabel } from "./_lib/camp-condition-done-label";

type ModalType = "health" | "movement" | "calving" | "death" | "reproduction" | "condition" | "weigh" | "treat" | "cover" | "mob_move" | null;

const DEATH_CAUSES_BY_SPECIES: Record<string, string[]> = {
  cattle: ["Unknown", "Redwater", "Heartwater", "Snake", "Old age", "Birth complications", "Other"],
  sheep:  ["Unknown", "Predation — Jackal", "Predation — Caracal", "Predation — Eagle", "Predation — Unknown", "Pulpy kidney", "Bluetongue", "Heartwater", "Old age", "Birth complications", "Other"],
  game:   ["Unknown", "Predation", "Disease", "Drought", "Fence injury", "Poaching", "Old age", "Other"],
};

interface MobWithCount {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
}

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
  const { mode } = useFarmModeSafe();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>("");
  const [allNormalDone, setAllNormalDone] = useState(false);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [flaggedAnimalIds, setFlaggedAnimalIds] = useState<Set<string>>(new Set());
  const [mobsInCamp, setMobsInCamp] = useState<MobWithCount[]>([]);
  const [selectedMob, setSelectedMob] = useState<MobWithCount | null>(null);
  const [mobDestCamp, setMobDestCamp] = useState("");
  const [mobMoving, setMobMoving] = useState(false);

  // useState-pair pattern (memory/feedback-react-state-from-props.md): Next.js
  // does NOT unmount this page when only the [campId] dynamic segment changes
  // — it re-renders the same instance. Without the camp-tracking pair below,
  // every state field above would leak across the camp A → camp B transition:
  //  - `activeModal` + `selectedAnimalId` + `selectedMob` + `mobDestCamp` +
  //    `mobMoving` keep an in-progress flow visible on the new camp's page.
  //  - `flaggedAnimalIds` carries the prior camp's flag set, mis-styling the
  //    new camp's animal rows + mis-counting the "Done — N flagged" copy.
  //  - `allNormalDone` keeps the green "Visit recorded" banner up after the
  //    user has navigated to a brand-new, un-inspected camp.
  //  - `animals` + `mobsInCamp` flash the prior camp's roster until the
  //    `useEffect` chain refires and the new fetches resolve.
  // Resetting all nine synchronously during the transition render is React's
  // officially-blessed pattern for adjusting state in response to prop change
  // — runs before commit, no extra render, no flicker. Same fix shape as
  // PR #59 (hero-image leak across [farmSlug]).
  const [prevCampId, setPrevCampId] = useState(decodedId);
  if (prevCampId !== decodedId) {
    setPrevCampId(decodedId);
    setActiveModal(null);
    setSelectedAnimalId("");
    setAllNormalDone(false);
    setAnimals([]);
    setFlaggedAnimalIds(new Set());
    setMobsInCamp([]);
    setSelectedMob(null);
    setMobDestCamp("");
    setMobMoving(false);
  }

  const camp = camps.find((c) => c.camp_id === decodedId);
  // camps in IndexedDB may carry merged condition fields (grazing_quality etc.) from updateCampCondition
  const campWithCondition = camp as (Camp & { grazing_quality?: string }) | undefined;
  const stats = { total: animals.length };

  // Load animals from IndexedDB, filtered by active farm mode species
  useEffect(() => {
    getAnimalsByCampCached(decodedId).then((all) => {
      // Filter by species: animals without a species field default to "cattle"
      const filtered = all.filter((a) => (a.species ?? "cattle") === mode);
      setAnimals(filtered);
    });
  }, [decodedId, mode]);

  // Load mobs for this camp from API
  useEffect(() => {
    if (!isOnline) return;
    fetch("/api/mobs")
      .then((res) => (res.ok ? res.json() : []))
      .then((allMobs: MobWithCount[]) => {
        setMobsInCamp(allMobs.filter((m) => m.current_camp === decodedId));
      })
      .catch(() => { /* non-fatal */ });
  }, [decodedId, isOnline]);

  async function handleMobMove() {
    if (!selectedMob || !mobDestCamp) return;
    setMobMoving(true);
    try {
      const result = await submitMobMove(
        {
          mobId: selectedMob.id,
          mobName: selectedMob.name,
          animalCount: selectedMob.animal_count,
          fromCampId: decodedId,
          toCampId: mobDestCamp,
        },
        { isOnline, refreshPendingCount, syncNow },
      );
      if (result.success) {
        setMobsInCamp((prev) => prev.filter((m) => m.id !== selectedMob.id));
        getAnimalsByCampCached(decodedId).then((all) => setAnimals(all.filter((a) => (a.species ?? "cattle") === mode)));
      }
    } finally {
      setMobMoving(false);
      setActiveModal(null);
      setSelectedMob(null);
      setMobDestCamp("");
    }
  }

  function handleFlag(animalId: string, type: Exclude<ModalType, "condition" | "cover" | "mob_move" | null>) {
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

  async function handleHealthSubmit(data: { symptoms: string[]; severity: string; photoBlob: Blob | null }) {
    const { photoBlob, ...obsData } = data;
    const localId = await queueObservation({
      type: "health_issue",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify(obsData),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    if (photoBlob) await queuePhoto(localId, photoBlob).catch(() => {/* non-fatal */});
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleMovementSubmit(data: { animalId: string; sourceCampId: string; destCampId: string; photoBlob: Blob | null }) {
    const { photoBlob, ...obsData } = data;
    const localId = await queueObservation({
      type: "animal_movement",
      camp_id: decodedId,
      animal_id: data.animalId,
      details: JSON.stringify(obsData),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    if (photoBlob) await queuePhoto(localId, photoBlob).catch(() => {/* non-fatal */});
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
    getAnimalsByCampCached(decodedId).then((all) => setAnimals(all.filter((a) => (a.species ?? "cattle") === mode)));
  }

  async function handleCalvingSubmit(data: CalvingData) {
    await submitCalvingObservation(data, {
      mode,
      campId: decodedId,
      isOnline,
      markAnimalFlagged,
      refreshPendingCount,
      syncNow,
    });
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
    getAnimalsByCampCached(decodedId).then((all) => setAnimals(all.filter((a) => (a.species ?? "cattle") === mode)));
  }

  async function handleWeighSubmit(data: { weightKg: number; photoBlob: Blob | null }) {
    const localId = await queueObservation({
      type: "weighing",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify({ weight_kg: data.weightKg }),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    if (data.photoBlob) await queuePhoto(localId, data.photoBlob).catch(() => {/* non-fatal */});
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleTreatmentSubmit(data: {
    treatmentType: string;
    product: string;
    dose: string;
    withdrawalDays: number;
    photoBlob: Blob | null;
  }) {
    const { photoBlob, ...obsFields } = data;
    const localId = await queueObservation({
      type: "treatment",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify(obsFields),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    if (photoBlob) await queuePhoto(localId, photoBlob).catch(() => {/* non-fatal */});
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleReproSubmit(data: ReproSubmitData) {
    const localId = await queueObservation({
      type: data.type,
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      details: JSON.stringify(data.details),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    if (data.photoBlob) await queuePhoto(localId, data.photoBlob).catch(() => {/* non-fatal */});
    markAnimalFlagged(selectedAnimalId);
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleCoverSubmit(data: {
    coverCategory: "Good" | "Fair" | "Poor";
    photoBlob: Blob | null;
    clientLocalId: string;
  }) {
    await queueCoverReading({
      farm_slug: farmSlug,
      camp_id: decodedId,
      cover_category: data.coverCategory,
      created_at: new Date().toISOString(),
      photo_blob: data.photoBlob ?? undefined,
      sync_status: "pending",
      // Issue #207 — mount-stable UUID from CampCoverLogForm. Persisted on
      // the queue row + replayed verbatim by sync-manager so a retry
      // collapses to the same server row via the upsert path.
      clientLocalId: data.clientLocalId,
    });
    refreshPendingCount();
    if (isOnline) syncNow();
    setActiveModal(null);
  }

  async function handleConditionSubmit(data: {
    campId: string;
    grazing: GrazingQuality;
    water: WaterStatus;
    fence: FenceStatus;
    photoBlob: Blob | null;
    clientLocalId: string;
  }) {
    const { photoBlob, clientLocalId, ...obsData } = data;
    const now = new Date().toISOString();
    const loggedBy = session?.user?.name ?? "Logger";
    const localId = await queueObservation({
      type: "camp_condition",
      camp_id: decodedId,
      details: JSON.stringify({ ...obsData, logged_by: loggedBy }),
      created_at: now,
      synced_at: null,
      sync_status: "pending",
      // Issue #206 — mount-stable UUID from CampConditionForm. Persisted on
      // the queue row + replayed verbatim by sync-manager so a retry collapses
      // to the same server row via Observation.clientLocalId upsert.
      clientLocalId,
    });
    if (photoBlob) await queuePhoto(localId, photoBlob).catch(() => {/* non-fatal */});
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

  // Use grey when no condition has ever been recorded; do not default to "Fair"
  const grazingQuality = campWithCondition?.grazing_quality ?? null;
  const grazingDot = grazingQuality ? getGrazingDot(grazingQuality) : "bg-gray-500";
  const grazingBadge = grazingQuality ? getGrazingTailwindBg(grazingQuality) : "bg-gray-800/50 text-gray-400";

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
              {grazingQuality ?? "No data"}
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
                : campConditionDoneLabel(campWithCondition?.grazing_quality)}
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
        <AnimalChecklist campId={decodedId} onFlag={handleFlag} animals={animals} flaggedIds={flaggedAnimalIds} species={mode} />
      </div>

      {/* Mobs in this camp */}
      {mobsInCamp.length > 0 && (
        <div
          className="mx-3 mb-3 rounded-2xl overflow-hidden"
          style={{
            backgroundColor: 'rgba(44, 21, 8, 0.65)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(139, 105, 20, 0.2)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: '1px solid rgba(92, 61, 46, 0.35)' }}
          >
            <p className="text-sm font-semibold" style={{ color: '#F5F0E8' }}>
              Mobs in camp ({mobsInCamp.length})
            </p>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {mobsInCamp.map((mob) => (
              <div
                key={mob.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{
                  backgroundColor: 'rgba(92, 61, 46, 0.4)',
                  border: '1px solid rgba(139, 105, 20, 0.15)',
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#F5F0E8' }}>
                    {mob.name}
                  </p>
                  <p className="text-xs" style={{ color: '#D2B48C' }}>
                    {mob.animal_count} animal{mob.animal_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedMob(mob);
                    setMobDestCamp("");
                    setActiveModal("mob_move");
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                  style={{
                    backgroundColor: '#B87333',
                    color: '#F5F0E8',
                  }}
                >
                  Move Mob
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Camp-level buttons — sticky at bottom */}
      <div
        className="sticky bottom-0 px-4 py-3 flex flex-col gap-2"
        style={{
          backgroundColor: 'rgba(26, 13, 5, 0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(92, 61, 46, 0.4)',
        }}
      >
        <button
          onClick={() => setActiveModal("cover")}
          className="w-full font-semibold py-3.5 rounded-2xl text-sm transition-all flex items-center justify-center gap-2 active:scale-95"
          style={{
            backgroundColor: 'rgba(92, 61, 46, 0.6)',
            color: '#F5F0E8',
            border: '1px solid rgba(139, 105, 20, 0.3)',
          }}
        >
          Record Cover
        </button>
        <button
          onClick={() => setActiveModal("condition")}
          className="w-full font-semibold py-3.5 rounded-2xl text-sm transition-all flex items-center justify-center gap-2 active:scale-95"
          style={{
            backgroundColor: 'rgba(92, 61, 46, 0.6)',
            color: '#F5F0E8',
            border: '1px solid rgba(139, 105, 20, 0.3)',
          }}
        >
          Report Camp Condition
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
        <DeathModal
          isOpen
          animalId={selectedAnimalId}
          causes={DEATH_CAUSES_BY_SPECIES[mode] ?? DEATH_CAUSES_BY_SPECIES.cattle}
          onSelect={handleDeathSubmit}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "reproduction" && (
        <ReproductionForm
          animalId={selectedAnimalId}
          animalSex={animals.find((a) => a.animal_id === selectedAnimalId)?.sex as "Male" | "Female" | undefined}
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
      {activeModal === "weigh" && (
        <WeighingForm
          animalTag={selectedAnimalId}
          onSubmit={handleWeighSubmit}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "treat" && (
        <TreatmentForm
          animalTag={selectedAnimalId}
          onSubmit={handleTreatmentSubmit}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "cover" && (
        <CampCoverLogForm
          campName={camp.camp_name}
          onSubmit={handleCoverSubmit}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "mob_move" && (
        <MobMoveModal
          isOpen
          mob={selectedMob}
          camps={camps}
          currentCampId={decodedId}
          destCamp={mobDestCamp}
          onDestCampChange={setMobDestCamp}
          onConfirm={handleMobMove}
          onClose={() => { setActiveModal(null); setSelectedMob(null); }}
          isSubmitting={mobMoving}
        />
      )}
    </div>
  );
}
