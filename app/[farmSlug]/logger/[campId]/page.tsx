"use client";

import { use, useState, useEffect, useCallback } from "react";
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
import { relativeTime } from "@/lib/utils";
import { Icon, StatusPill, Button } from "@/components/ds";
import { grazingToStatus } from "@/components/logger/grazing-status";
import type { Camp } from "@/lib/types";
import { getAnimalsByCampCached, getPendingObservations, queueObservation, queuePhoto, queueCoverReading, updateCampCondition, updateAnimalCamp, updateAnimalStatus } from "@/lib/offline-store";
import { useOffline } from "@/components/logger/OfflineProvider";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Animal, GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { classifySyncFailure, type SyncToastHint } from "@/lib/sync/failure-classifier";
import { resolvePostSubmitNav, resolveNavHoldMs, type InlinePostResult } from "@/lib/logger/post-submit-nav";
import { useHeldNavigation } from "@/lib/client/use-held-navigation";
import { getCampVisitCompletenessLabel } from "./_lib/camp-condition-done-label";
import { resolveCampByUrlSegment } from "./_lib/resolve-camp-by-url-segment";

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
  // Issue #447 — defer the post-submit navigation while a duplicate toast is
  // visible (Esc skips the wait). `navigate` is a stable wrapper so the hook's
  // Esc listener and timer reference one identity across renders.
  const navigate = useCallback((to: string) => router.push(to), [router]);
  const { scheduleHeldNavigation } = useHeldNavigation(navigate);
  const { data: session } = useSession();
  const { isOnline, refreshPendingCount, refreshCampsState, camps, campsLoaded, syncNow } = useOffline();
  const { mode } = useFarmModeSafe();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>("");
  const [allNormalDone, setAllNormalDone] = useState(false);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [flaggedAnimalIds, setFlaggedAnimalIds] = useState<Set<string>>(new Set());
  // Issue #440 — count of observations already queued for this camp today
  // (persisted in IDB). Seeded from IDB on mount + after each flag so the
  // banner copy "Done — N observations · all animals normal" stays current
  // even after navigating away and returning to the same camp.
  const [visitObsCount, setVisitObsCount] = useState(0);
  const [mobsInCamp, setMobsInCamp] = useState<MobWithCount[]>([]);
  const [selectedMob, setSelectedMob] = useState<MobWithCount | null>(null);
  const [mobDestCamp, setMobDestCamp] = useState("");
  const [mobMoving, setMobMoving] = useState(false);
  // Issue #281 — per-visit idempotency key for the "complete visit / all
  // normal" enqueue. handleCompleteVisit is a bare page button (no form
  // component to host a mount-stable UUID like CampConditionForm/
  // CampCoverLogForm do), so the key lives in page state. Generated once
  // per camp visit and replayed VERBATIM on every retry (refresh,
  // reconnect, offline-queue replay, double-click) so the server upsert on
  // Observation.clientLocalId collapses duplicate camp_check POSTs to a
  // single stored inspection. Regenerated when the camp changes (reset
  // block below) so two distinct visits never collide.
  const [visitClientLocalId, setVisitClientLocalId] = useState<string>(() => crypto.randomUUID());
  // Issue #436 — transient toast surface for the inline camp-condition
  // submit path. Populated only when `classifySyncFailure` returns a
  // user-presentable hint after a synchronous POST to /api/observations.
  // The copy is owned by the classifier (single source of truth shared
  // with the background sync path in `lib/sync-manager.ts`) — never
  // hardcoded here. `null` clears the toast.
  const [submitToast, setSubmitToast] = useState<SyncToastHint | null>(null);

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
    setVisitObsCount(0);
    setMobsInCamp([]);
    setSelectedMob(null);
    setMobDestCamp("");
    setMobMoving(false);
    // Issue #281 — a brand-new camp is a brand-new visit: mint a fresh
    // idempotency key so camp B's "all normal" enqueue never dedupes
    // against camp A's stored inspection on the server upsert.
    setVisitClientLocalId(crypto.randomUUID());
    // Issue #436 — clear any duplicate-submit toast carried over from
    // camp A so it never bleeds into camp B's surface.
    setSubmitToast(null);
  }

  // Issue #421 — case-insensitive lookup. libSQL Prisma adapter does NOT
  // support `mode: 'insensitive'` in `where` clauses, so the fold lives on
  // the client (we read from IndexedDB anyway via useOffline().camps). See
  // _lib/resolve-camp-by-url-segment.ts for the contract + rationale.
  const camp = resolveCampByUrlSegment(camps, decodedId);
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

  // Issue #440 — seed observation count from IDB for this camp + today.
  // Runs when campId changes AND after flaggedAnimalIds changes (each submit
  // marks an animal flagged, so the effect re-fires and picks up the new row).
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    getPendingObservations().then((obs) => {
      setVisitObsCount(
        obs.filter((o) => o.camp_id === decodedId && o.created_at.startsWith(today)).length,
      );
    });
  }, [decodedId, flaggedAnimalIds]);

  // Load mobs for this camp from API.
  // Issue #450 — case-insensitive comparison: the URL `[campId]` segment
  // may differ in casing from the server-canonical `current_camp` (deep
  // links, hand-typed URLs). Same root cause as the animal-count miss
  // fixed in `getAnimalsByCampCached`; symmetric fix here.
  useEffect(() => {
    if (!isOnline) return;
    const target = decodedId.toLowerCase();
    fetch("/api/mobs")
      .then((res) => (res.ok ? res.json() : []))
      .then((allMobs: MobWithCount[]) => {
        setMobsInCamp(allMobs.filter((m) => m.current_camp.toLowerCase() === target));
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
      // Issue #281 — per-visit mount-stable UUID. Persisted on the queue
      // row + replayed verbatim by sync-manager so a retry collapses to
      // the same server row via the Observation.clientLocalId upsert.
      clientLocalId: visitClientLocalId,
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
    // Issue #100 — local IDB write keeps the moved animal off this camp's list
    // immediately (offline-first UX). The SERVER `currentCamp` advance is now
    // carried by the queued `animal_movement` observation above: on replay,
    // `POST /api/observations` routes it through `performAnimalMove`, which
    // advances `currentCamp` atomically with the observation write. The old
    // `navigator.onLine` fire-and-forget `PATCH /api/animals/[id]` was REMOVED
    // — offline it never fired and had no replay queue, so the move was
    // silently lost (the #100 bug). The observation queue replays idempotently
    // via `clientLocalId` (#206), so the move now survives a reconnect drain.
    await updateAnimalCamp(data.animalId, data.destCampId);
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

  async function handleDeathSubmit(data: { cause: string; carcassDisposal: string; notes: string }) {
    await queueObservation({
      type: "death",
      camp_id: decodedId,
      animal_id: selectedAnimalId,
      // Wave 3b / #254 — `carcassDisposal` joins `cause` in the JSON details
      // payload. The shared POST /api/observations route invokes
      // `validateDeathObservation` (lib/server/validators/death.ts) and
      // rejects a missing/invalid disposal with 422 DEATH_DISPOSAL_REQUIRED.
      // The DeathModal's submit-gate is the UX-layer half of the same
      // defense-in-depth.
      details: JSON.stringify({
        cause: data.cause,
        carcassDisposal: data.carcassDisposal,
      }),
      // Issue #492 — first-class free-text note (Path A). Queued alongside the
      // structured death details; replayed verbatim by sync-manager into the
      // POST body's top-level `notes` field → the `Observation.notes` column.
      // Omitted when blank so the column stays null.
      notes: data.notes.trim() === "" ? undefined : data.notes,
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
    // Issue #538 — local IDB write removes the deceased animal from this camp's
    // active list immediately (offline-first UX). The SERVER `status =
    // "Deceased"` (+ `deceasedAt`) advance is now carried by the queued `death`
    // observation above: on replay, `POST /api/observations` routes it through
    // `performAnimalDeath`, which sets the status atomically with the
    // observation write (anchoring `deceasedAt` to the observation's own
    // timestamp). The old `navigator.onLine` fire-and-forget
    // `PATCH /api/animals/[id]` was REMOVED — offline it never fired and had no
    // replay queue, so the death status was silently lost (the #538 bug, the
    // higher-stakes twin of #100). The observation queue replays idempotently
    // via `clientLocalId` (#206), so the death now survives a reconnect drain.
    await updateAnimalStatus(selectedAnimalId, "Deceased");
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
    const detailsJson = JSON.stringify({ ...obsData, logged_by: loggedBy });
    // Issue #436 — IDB-queue is unconditional so an offline / mid-flight
    // network drop can never lose the row. The server upsert on
    // `clientLocalId` (#206) collapses any subsequent retry against the
    // inline POST below to a single stored row.
    const localId = await queueObservation({
      type: "camp_condition",
      camp_id: decodedId,
      details: detailsJson,
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

    // Issue #436 — inline POST so a 422 DUPLICATE_OBSERVATION surfaces a
    // visible toast BEFORE the user navigates away. Previously the inline
    // path queued + fire-and-forget `syncNow()` then `router.push`, so any
    // duplicate detected during the background sync went to the dead-letter
    // bucket invisibly (the user had already left the page). The toast copy
    // is sourced from `classifySyncFailure` — the same single source of
    // truth used by `lib/sync-manager.ts`'s background sync path — so the
    // same wire response ALWAYS produces the same user-facing message
    // whether the 422 hits inline or during a reconnect drain.
    //
    // Offline branch: skip the inline POST entirely. `inlineResult` stays
    // undefined and the resolver's offline branch (issue #465) returns
    // `hold` — keeping the user in the logger so OfflineProvider stays
    // mounted and its `online → syncNow` reconnect auto-drain fires. The
    // background sync's classifier path surfaces any duplicate via the
    // LoggerStatusBar's existing toast row when connectivity returns.
    let inlineResult: InlinePostResult | undefined;
    if (isOnline) {
      try {
        const res = await fetch("/api/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Mirrors the body shape `uploadObservation` (lib/sync-manager.ts)
          // posts during the background sync — same explicit-fields contract
          // so a future schema change is caught at both call sites.
          body: JSON.stringify({
            type: "camp_condition",
            camp_id: decodedId,
            animal_id: null,
            details: detailsJson,
            created_at: now,
            clientLocalId,
          }),
        });
        if (res.ok) {
          inlineResult = { kind: "ok" };
        } else {
          // Read body text first (raw bytes preserved) then JSON-parse for
          // the classifier — same defensive pattern as sync-manager.ts so
          // a non-JSON 5xx never throws on the parse path.
          const rawText = await res.text().catch(() => "");
          let parsedBody: unknown = null;
          try {
            if (rawText) parsedBody = JSON.parse(rawText);
          } catch {
            // Non-JSON body — classifier safely treats null as retriable.
          }
          const resolution = classifySyncFailure(res.status, parsedBody);
          if (resolution.toast) {
            setSubmitToast(resolution.toast);
          }
          inlineResult = { kind: "rejected", resolution };
          // On 422 DUPLICATE with `existingId` the server already has the
          // canonical row (resolution.action === "mark-succeeded"); the
          // resolver below navigates to the logger root so the camp tile
          // shows the existing condition's colour / last-inspected timestamp.
          // Any other resolution (terminal 422, retriable 5xx) leaves the
          // queued row for the background sync and the resolver returns
          // `hold` — the user stays on the camp page so they can react to
          // the surfaced toast (which stays visible for its 4 s TTL).
        }
      } catch {
        // Network error mid-submit (fetch threw). The queued row will be
        // retried by the next sync cycle; treat this like a recoverable
        // happy path — the resolver navigates so the farmer is not stranded
        // on the modal.
        inlineResult = { kind: "threw" };
      }
      // A reachable network (committed OR thrown) — kick a sync cycle so any
      // other pending rows drain in the same pass.
      syncNow();
    }

    // Single source of truth for the navigate-vs-hold decision (issue #465).
    // The unconditional `router.push` was the bug: when offline, the SW
    // served `/offline` and unmounted the queue-owning OfflineProvider.
    const decision = resolvePostSubmitNav({ isOnline, loggerRoot, inlineResult });
    if (decision.action === "navigate") {
      // Issue #447 — the auto-resolved duplicate path both shows a toast and
      // navigates; hold the push ~1.5s (Esc skips) so the toast is readable.
      // Every other navigate path returns 0 and pushes synchronously, so the
      // happy path gains no latency.
      scheduleHeldNavigation(decision.to, resolveNavHoldMs(inlineResult));
    } else {
      // Hold: stay in the logger. Close the modal so the user sees the
      // logger overview + the queued/pending affordance in the status bar.
      setActiveModal(null);
    }
  }

  if (!campsLoaded) {
    return (
      <div className="dark-surface ft-scope min-h-screen flex items-center justify-center">
        <p className="ft-mono" style={{ color: 'var(--ft-muted)' }}>Loading…</p>
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="dark-surface ft-scope min-h-screen flex items-center justify-center">
        <p className="ft-mono" style={{ color: 'var(--ft-muted)' }}>Camp not found: {decodedId}</p>
      </div>
    );
  }

  // Use neutral subtle when no condition has ever been recorded; do not default to "Fair"
  const grazingQuality = campWithCondition?.grazing_quality ?? null;
  const grazingStatus = grazingQuality ? grazingToStatus(grazingQuality) : null;

  return (
    <div className="dark-surface ft-scope min-h-screen flex flex-col">
      {/* Sticky header — PageHeader-style editorial chrome */}
      <div
        className="sticky top-0 z-10"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--ft-bg) 88%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--ft-border)',
          boxShadow: 'var(--ft-shadow-sm)',
        }}
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <Link
            href={loggerRoot}
            aria-label="Back to camp picker"
            className="ft-action-btn mt-1 shrink-0"
          >
            <Icon.chevronL size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="ft-mono" style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--ft-subtle)', textTransform: 'uppercase' }}>
              Logger
            </div>
            <h1
              className="ft-serif truncate"
              style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: 2, color: 'var(--ft-text)' }}
            >
              Camp {camp.camp_name}
            </h1>
            <p className="ft-mono text-[11px] mt-1.5" style={{ color: 'var(--ft-muted)' }}>
              {/* Issue #437 — surface species-scoped last_inspected_at next
                  to the head count. The value comes from the active-mode
                  IDB partition (sync-manager writes the species-scoped
                  payload from `/api/camps?species=<mode>`), so the cattle
                  camp_condition row never bleeds in on a sheep view —
                  the line shows "Never" when no species-matching
                  inspection has been logged. */}
              {stats.total} animals · {camp.water_source ?? "water"}
              {" · "}
              <span data-testid="camp-last-inspected">
                Last inspected:{" "}
                {campWithCondition?.last_inspected_at
                  ? relativeTime(campWithCondition.last_inspected_at)
                  : "Never"}
              </span>
            </p>
          </div>
          <div className="shrink-0 mt-1">
            {grazingStatus ? (
              <StatusPill status={grazingStatus} label={grazingQuality ?? undefined} />
            ) : (
              <span className="ft-pill ft-pill-muted">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 6, height: 6, background: 'var(--ft-subtle)' }}
                />
                No data
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sticky "All Normal" button */}
      <div
        className="sticky top-[88px] z-10 px-4 pt-3 pb-2"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--ft-bg) 70%, transparent)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {allNormalDone ? (
          <div
            className="w-full font-semibold py-5 rounded-2xl text-base text-center flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--ft-good-bg)', color: 'var(--ft-good)', border: '1px solid var(--ft-good)' }}
          >
            <Icon.check size={20} /> Visit recorded
          </div>
        ) : (
          <>
            {/* Issue #440 — observation-aware banner. getCampVisitCompletenessLabel
                returns { label, severity } from the 5-row matrix in the helper.
                Severity drives the button accent colour, now mapped onto the
                warm token scale:
                  good      → rust accent (var(--ft-accent))
                  attention → amber       (var(--ft-fair))
                  critical  → red         (var(--ft-crit))
                The caption (Issue #406) is preserved for the Good-veld baseline. */}
            {(() => {
              const { label, severity } = getCampVisitCompletenessLabel({
                grazingQuality: campWithCondition?.grazing_quality,
                observationCount: visitObsCount,
                flaggedCount: flaggedAnimalIds.size,
              });
              const btnBg = severity === 'critical' ? 'var(--ft-crit)' : severity === 'attention' ? 'var(--ft-fair)' : 'var(--ft-accent)';
              const btnShadow = severity === 'critical'
                ? '0 8px 26px -10px color-mix(in oklab, var(--ft-crit) 70%, transparent)'
                : severity === 'attention'
                  ? '0 8px 26px -10px color-mix(in oklab, var(--ft-fair) 70%, transparent)'
                  : '0 8px 26px -10px color-mix(in oklab, var(--ft-accent) 70%, transparent)';
              return (
                <button
                  onClick={handleCompleteVisit}
                  data-testid="camp-visit-completeness-btn"
                  className="w-full font-semibold py-5 rounded-2xl text-base transition-all flex items-center justify-center gap-3 active:scale-95"
                  style={{ backgroundColor: btnBg, color: '#FFF6EE', boxShadow: btnShadow }}
                >
                  <Icon.check size={20} />
                  <span>{label}</span>
                </button>
              );
            })()}
          </>
        )}
      </div>

      {/* Animal list */}
      <div
        className="ft-card flex-1 mt-3 mx-3 mb-3 overflow-hidden"
        style={{ padding: 0 }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--ft-border)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ft-text)' }}>
            Animals in camp <span className="ft-mono" style={{ color: 'var(--ft-subtle)' }}>({stats.total})</span>
          </p>
          <p className="ft-label">
            Tap icon to report
          </p>
        </div>
        <AnimalChecklist campId={decodedId} onFlag={handleFlag} animals={animals} flaggedIds={flaggedAnimalIds} species={mode} />
      </div>

      {/* Mobs in this camp */}
      {mobsInCamp.length > 0 && (
        <div
          className="ft-card mx-3 mb-3 overflow-hidden"
          style={{ padding: 0 }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: '1px solid var(--ft-border)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--ft-text)' }}>
              Mobs in camp <span className="ft-mono" style={{ color: 'var(--ft-subtle)' }}>({mobsInCamp.length})</span>
            </p>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {mobsInCamp.map((mob) => (
              <div
                key={mob.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{
                  backgroundColor: 'var(--ft-surface2)',
                  border: '1px solid var(--ft-border)',
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--ft-text)' }}>
                    {mob.name}
                  </p>
                  <p className="ft-mono text-xs" style={{ color: 'var(--ft-muted)' }}>
                    {mob.animal_count} animal{mob.animal_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={<Icon.move size={15} />}
                  onClick={() => {
                    setSelectedMob(mob);
                    setMobDestCamp("");
                    setActiveModal("mob_move");
                  }}
                  className="text-xs active:scale-95"
                  style={{ padding: '7px 13px' }}
                >
                  Move Mob
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Camp-level buttons — sticky at bottom */}
      <div
        className="sticky bottom-0 px-4 py-3 flex flex-col gap-2"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--ft-bg) 82%, transparent)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderTop: '1px solid var(--ft-border)',
        }}
      >
        <button
          onClick={() => setActiveModal("cover")}
          className="ft-btn w-full active:scale-95"
          style={{ justifyContent: 'center', padding: '13px' }}
        >
          <Icon.edit size={16} /> <span>Record Cover</span>
        </button>
        <button
          onClick={() => setActiveModal("condition")}
          className="ft-btn w-full active:scale-95"
          style={{ justifyContent: 'center', padding: '13px' }}
        >
          <Icon.grass size={16} /> <span>Report Camp Condition</span>
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
          onSubmit={handleDeathSubmit}
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

      {/* Issue #436 — inline camp-condition duplicate-submit toast.
          Renders only when `handleConditionSubmit` populates `submitToast`
          via `classifySyncFailure` (single-source-of-truth copy shared
          with the background sync path). `role="alert"` so screen readers
          announce a same-day duplicate to the farmer. Position mirrors
          the LoggerStatusBar's existing sync-result toast row so the two
          surfaces feel coherent during a partial-failure cycle. */}
      {submitToast && (
        <div
          data-testid="camp-condition-submit-toast"
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl"
          style={{
            backgroundColor:
              submitToast.kind === "duplicate"
                ? "var(--ft-accent)"
                : "var(--ft-crit)",
            color: "#FFF6EE",
          }}
        >
          {submitToast.message}
        </div>
      )}
    </div>
  );
}
