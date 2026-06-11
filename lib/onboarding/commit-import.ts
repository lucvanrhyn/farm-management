/**
 * B4a — commitImport library
 * -----------------------------------------------------------------------------
 * Takes a mapped-and-validated import payload and writes it to the database.
 * The calling HTTP route (B4b) wraps this with auth + SSE streaming.
 *
 * Pipeline:
 *  1. Validation   — de-dupe within batch, check earTag/dateOfBirth/sex/status
 *  2. Pedigree     — topological sort so sires/dams are inserted first,
 *                    detect cycles, prune affected rows
 *  3. Inserting    — transactional prisma.animal.create per row; per-row
 *                    failures are captured as errors (not aborts)
 *  4. Done         — update ImportJob with final counts
 *
 * Schema note: this repo's Animal model stores parent ear-tag strings in
 * `fatherId`/`motherId` (no FK). ImportRow speaks the SAME schema-name
 * vocabulary the AI wizard emits as mapping targets (S11 / H1 / OB-001 —
 * see `IMPORT_ROW_FIELDS` in client-types.ts): `motherId`/`fatherId` are
 * ear-tag references resolved against this batch + existing animals.
 * Pedigree resolution runs a topological sort so cycles are rejected and
 * ordering is deterministic.
 *
 * ImportJob fields used: `rowsImported`, `rowsFailed`, `warnings`, `status`,
 * `completedAt`.
 */

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { AFRIKAANS_STATUS_MAP } from "@/lib/onboarding/schema-dictionary";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * One spreadsheet row in the canonical schema-name vocabulary.
 *
 * Field names MUST stay in lock-step with `IMPORT_ROW_FIELDS`
 * (lib/onboarding/client-types.ts) — a compile-time assertion there fails the
 * build on drift. Enum-ish fields (`sex`, `status`, `category`) are `string`
 * on the wire and validated here, at the system boundary.
 */
export type ImportRow = {
  earTag: string; // required, unique per animal within farm (Animal.animalId)
  registrationNumber?: string; // stud book number
  breed?: string;
  sex?: string; // "Male" | "Female" — validated in validateRows
  category?: string; // Cow/Bull/Heifer/... — free label, defaults "Unknown"
  dateOfBirth?: Date | string; // ISO or Date
  motherId?: string; // dam ear-tag ref — may reference another row in THIS import
  fatherId?: string; // sire ear-tag ref — may reference another row in THIS import
  currentCamp?: string; // camp reference (campId slug or raw camp name)
  status?: string; // Active | Sold | Deceased (Afrikaans normalized server-side)
  species?: string; // per-row override of defaultSpecies; validated against ALLOWED_SPECIES
  deceasedAt?: Date | string; // ISO or Date — only meaningful with status Deceased
  sireNote?: string; // free-text fallback when the sire isn't in this file
  damNote?: string; // free-text fallback when the dam isn't in this file
};

export type CommitImportInput = {
  rows: ImportRow[];
  importJobId: string; // caller pre-creates the ImportJob row
  /**
   * Fallback species used when a row does not specify `species`. Must be one
   * of ALLOWED_SPECIES. Required — callers must make this choice explicitly so
   * we don't silently default to cattle and regress multi-species support.
   */
  defaultSpecies: string;
};

export type CommitImportProgress = {
  phase: "validating" | "pedigree" | "inserting" | "done";
  processed: number;
  total: number;
};

export type CommitImportError = {
  row: number;
  earTag?: string;
  reason: string;
};

export type CommitImportResult = {
  inserted: number;
  skipped: number;
  errors: CommitImportError[];
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VALIDATE_PROGRESS_INTERVAL = 50;
const INSERT_PROGRESS_INTERVAL = 25;
const PEDIGREE_PROGRESS_STEPS = 4; // 25% intervals
const TRANSACTION_MAX_WAIT_MS = 30_000;
const TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * Allowed species values. Must match the multi-species registry
 * (see `multi-species-architecture.md`).
 */
const ALLOWED_SPECIES = new Set(["cattle", "sheep", "goats", "game"]);

/**
 * Hard bound on the camp-resolution lookup (S12). Real farms hold tens of
 * camps; this exists purely so the `findMany` is provably bounded
 * (audit-findmany-no-take) even on a pathological tenant.
 */
const CAMP_LOOKUP_LIMIT = 1_000;

/**
 * Sentinel `Animal.currentCamp` value for rows that reference no camp.
 * Pre-dates S12; intentionally NOT materialized as a Camp row.
 */
const UNASSIGNED_CAMP = "unassigned";

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

type ValidatedRow = {
  /** Index in the original input.rows array (1-based for reporting). */
  originalIndex: number;
  earTag: string;
  registrationNumber?: string;
  breed?: string;
  sex?: "Male" | "Female";
  category?: string;
  dateOfBirthIso?: string;
  /** Dam ear-tag reference (in-batch or existing animal). */
  motherId?: string;
  /** Sire ear-tag reference (in-batch or existing animal). */
  fatherId?: string;
  currentCamp?: string;
  /** Canonical "Active" | "Sold" | "Deceased". */
  status?: string;
  /** Resolved per-row species (row.species if valid, else undefined — caller applies defaultSpecies at insert). */
  species?: string;
  deceasedAtIso?: string;
  sireNote?: string;
  damNote?: string;
};

function parseDateOnly(value: Date | string): string | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString().split("T")[0];
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (isNaN(parsed)) return null;
  return new Date(parsed).toISOString().split("T")[0];
}

/**
 * Trim an optional string field; empty/whitespace-only collapses to undefined.
 * Rows arrive from a JSON HTTP boundary, so a field typed `string` may carry
 * any JSON value at runtime — non-strings collapse to undefined instead of
 * throwing mid-validation.
 */
function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

/**
 * Validate a single row. Returns the validated shape, or a per-row error.
 * `seenEarTags` is mutated by the caller AFTER a row is accepted.
 */
function validateRow(
  row: ImportRow,
  rowNum: number,
  seenEarTags: ReadonlySet<string>,
): { ok: ValidatedRow } | { err: CommitImportError } {
  const rawEarTag = typeof row.earTag === "string" ? row.earTag.trim() : "";

  if (!rawEarTag) {
    return { err: { row: rowNum, reason: "missing earTag" } };
  }
  if (seenEarTags.has(rawEarTag)) {
    return {
      err: { row: rowNum, earTag: rawEarTag, reason: "duplicate earTag within import" },
    };
  }
  if (row.sex !== undefined && row.sex !== "Male" && row.sex !== "Female") {
    return { err: { row: rowNum, earTag: rawEarTag, reason: "invalid sex" } };
  }
  if (
    row.species !== undefined &&
    row.species !== null &&
    row.species !== "" &&
    !ALLOWED_SPECIES.has(row.species)
  ) {
    return { err: { row: rowNum, earTag: rawEarTag, reason: "invalid species" } };
  }

  let dateOfBirthIso: string | undefined;
  if (row.dateOfBirth !== undefined && row.dateOfBirth !== null && row.dateOfBirth !== "") {
    const parsed = parseDateOnly(row.dateOfBirth);
    if (parsed === null) {
      return { err: { row: rowNum, earTag: rawEarTag, reason: "invalid dateOfBirth" } };
    }
    dateOfBirthIso = parsed;
  }

  let deceasedAtIso: string | undefined;
  if (row.deceasedAt !== undefined && row.deceasedAt !== null && row.deceasedAt !== "") {
    const parsed = parseDateOnly(row.deceasedAt);
    if (parsed === null) {
      return { err: { row: rowNum, earTag: rawEarTag, reason: "invalid deceasedAt" } };
    }
    deceasedAtIso = parsed;
  }

  let status: string | undefined;
  const rawStatus = trimmedOrUndefined(row.status);
  if (rawStatus !== undefined) {
    const normalized = AFRIKAANS_STATUS_MAP[rawStatus.toLowerCase()];
    if (normalized === undefined) {
      return { err: { row: rowNum, earTag: rawEarTag, reason: "invalid status" } };
    }
    status = normalized;
  }

  const resolvedSpecies =
    row.species && ALLOWED_SPECIES.has(row.species) ? row.species : undefined;

  return {
    ok: {
      originalIndex: rowNum,
      earTag: rawEarTag,
      registrationNumber: trimmedOrUndefined(row.registrationNumber),
      breed: trimmedOrUndefined(row.breed),
      sex: row.sex,
      category: trimmedOrUndefined(row.category),
      dateOfBirthIso,
      motherId: trimmedOrUndefined(row.motherId),
      fatherId: trimmedOrUndefined(row.fatherId),
      currentCamp: trimmedOrUndefined(row.currentCamp),
      status,
      species: resolvedSpecies,
      deceasedAtIso,
      sireNote: trimmedOrUndefined(row.sireNote),
      damNote: trimmedOrUndefined(row.damNote),
    },
  };
}

/**
 * Phase 1 — validate and de-dupe rows.
 * Returns the kept rows (validated shape) plus per-row errors for rejected rows.
 */
function validateRows(
  rows: ImportRow[],
  onProgress?: (p: CommitImportProgress) => void,
): { kept: ValidatedRow[]; errors: CommitImportError[] } {
  const kept: ValidatedRow[] = [];
  const errors: CommitImportError[] = [];
  const seenEarTags = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const result = validateRow(rows[i], i + 1, seenEarTags);
    if ("err" in result) {
      errors.push(result.err);
    } else {
      seenEarTags.add(result.ok.earTag);
      kept.push(result.ok);
    }

    if ((i + 1) % VALIDATE_PROGRESS_INTERVAL === 0) {
      onProgress?.({ phase: "validating", processed: i + 1, total: rows.length });
    }
  }

  // Final validation progress tick so subscribers see a terminal state.
  if (rows.length > 0) {
    onProgress?.({ phase: "validating", processed: rows.length, total: rows.length });
  }

  return { kept, errors };
}

/**
 * Phase 2 — topologically sort rows by pedigree (sire/dam) dependencies.
 * Rows whose parent is another row in this batch MUST be inserted after the
 * parent. Cycles cause every row in the cycle to be dropped with
 * "pedigree cycle".
 *
 * Rows with a `fatherId`/`motherId` that references an ear tag not in this
 * batch are unaffected by ordering — they rely on existing DB state, which
 * the insert phase validates.
 */
function topologicallyOrder(
  rows: ValidatedRow[],
  onProgress?: (p: CommitImportProgress) => void,
): { ordered: ValidatedRow[]; errors: CommitImportError[] } {
  const errors: CommitImportError[] = [];
  const byEarTag = new Map<string, ValidatedRow>();
  for (const row of rows) byEarTag.set(row.earTag, row);

  // Build in-batch parent edges: row -> set of in-batch parent earTags it depends on.
  const inBatchParents = new Map<string, Set<string>>();
  const rowsNeedingPedigree: ValidatedRow[] = [];

  for (const row of rows) {
    const parents = new Set<string>();
    if (row.fatherId && byEarTag.has(row.fatherId)) parents.add(row.fatherId);
    if (row.motherId && byEarTag.has(row.motherId)) parents.add(row.motherId);

    // Self-reference is a trivial cycle.
    if (parents.has(row.earTag)) {
      // handled below in cycle detection; for now include it
    }
    inBatchParents.set(row.earTag, parents);
    if (parents.size > 0 || row.fatherId || row.motherId) {
      rowsNeedingPedigree.push(row);
    }
  }

  // Kahn's algorithm: repeatedly pick nodes whose in-batch parents are already placed.
  const placed = new Set<string>();
  const ordered: ValidatedRow[] = [];
  const totalPedigree = rowsNeedingPedigree.length;
  const progressStep = Math.max(1, Math.ceil(totalPedigree / PEDIGREE_PROGRESS_STEPS));
  let lastEmitted = 0;

  let progress = true;
  while (progress) {
    progress = false;
    for (const row of rows) {
      if (placed.has(row.earTag)) continue;
      const parents = inBatchParents.get(row.earTag)!;
      // A row is ready when every in-batch parent is already placed AND the row
      // does not depend on itself.
      if (parents.has(row.earTag)) continue; // self-cycle — skip here
      let ready = true;
      for (const p of parents) {
        if (!placed.has(p)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        ordered.push(row);
        placed.add(row.earTag);
        progress = true;
        // Progress pings every 25% of pedigree-affected rows.
        if (totalPedigree > 0) {
          const resolvedPedigree = ordered.filter((r) =>
            rowsNeedingPedigree.some((x) => x.earTag === r.earTag),
          ).length;
          if (resolvedPedigree - lastEmitted >= progressStep || resolvedPedigree === totalPedigree) {
            onProgress?.({
              phase: "pedigree",
              processed: resolvedPedigree,
              total: totalPedigree,
            });
            lastEmitted = resolvedPedigree;
          }
        }
      }
    }
  }

  // Anything left unplaced is in a cycle (or depends on a cycle member).
  for (const row of rows) {
    if (!placed.has(row.earTag)) {
      errors.push({
        row: row.originalIndex,
        earTag: row.earTag,
        reason: "pedigree cycle",
      });
    }
  }

  // Emit a final pedigree progress so callers always see this phase end.
  if (totalPedigree > 0) {
    onProgress?.({
      phase: "pedigree",
      processed: totalPedigree,
      total: totalPedigree,
    });
  }

  return { ordered, errors };
}

/**
 * Detect a unique-constraint violation across the shapes we see in practice:
 * Prisma's typed P2002 and the raw libSQL/SQLite "UNIQUE constraint failed"
 * driver message.
 */
function isUniqueViolation(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  ) {
    return true;
  }
  return err instanceof Error && /unique constraint/i.test(err.message);
}

/** Camp reference -> campId slug, per the wizard contract (lowercase, dashes for spaces). */
function slugifyCampRef(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Composite key for a camp reference: camps are unique per (species, campId). */
function campKey(species: string, ref: string): string {
  return `${species} ${ref}`;
}

/**
 * Phase 2.5 (S12 / H2 / OB-006) — resolve every referenced camp BEFORE the
 * insert phase. Previously `currentCamp` was written with no existence
 * check and no camp was ever created, so imported animals pointed at camps
 * that did not exist.
 *
 * - Existing camps are matched per species by campId (exact or slugified
 *   reference) or by display name (trimmed, case-insensitive) and reused.
 * - Unknown references become species-scoped placeholder camps (composite
 *   (species, campId) key — ADR-0005 / #28 Phase A); the farmer draws the
 *   boundary post-import.
 * - A unique-constraint race on placeholder creation means a concurrent
 *   import won — treat the camp as existing.
 * - Any other creation failure drops ONLY the affected rows with a typed
 *   per-row reason (never the raw driver text), so one bad camp cannot
 *   re-introduce the dangling-reference bug for its rows.
 *
 * Returns a NEW row array (rows are never mutated) with `currentCamp`
 * rewritten to the resolved campId.
 */
async function resolveReferencedCamps(
  prisma: PrismaClient,
  rows: ValidatedRow[],
  defaultSpecies: string,
): Promise<{ resolvedRows: ValidatedRow[]; errors: CommitImportError[] }> {
  const needed = new Map<string, { species: string; ref: string }>();
  for (const row of rows) {
    if (!row.currentCamp) continue;
    const species = row.species ?? defaultSpecies;
    needed.set(campKey(species, row.currentCamp), {
      species,
      ref: row.currentCamp,
    });
  }
  if (needed.size === 0) {
    return { resolvedRows: rows, errors: [] };
  }

  const speciesList = Array.from(
    new Set(Array.from(needed.values(), (n) => n.species)),
  );
  // cross-species by design: one query resolves every species bucket in the
  // batch; per-species matching happens below against the composite key.
  const existingCamps = await crossSpecies(
    prisma,
    "species-registry-internal",
  ).camp.findMany({
    where: { species: { in: speciesList } },
    select: { campId: true, campName: true, species: true },
    take: CAMP_LOOKUP_LIMIT,
  });

  // species -> normalized lookup token -> campId
  const lookupBySpecies = new Map<string, Map<string, string>>();
  for (const camp of existingCamps) {
    const lookup =
      lookupBySpecies.get(camp.species) ?? new Map<string, string>();
    lookup.set(camp.campId.toLowerCase(), camp.campId);
    lookup.set(camp.campName.trim().toLowerCase(), camp.campId);
    lookupBySpecies.set(camp.species, lookup);
  }

  const resolvedByKey = new Map<string, string>();
  const failedKeys = new Set<string>();
  for (const [key, { species, ref }] of needed) {
    const lookup = lookupBySpecies.get(species);
    const matched =
      lookup?.get(ref.trim().toLowerCase()) ?? lookup?.get(slugifyCampRef(ref));
    if (matched !== undefined) {
      resolvedByKey.set(key, matched);
      continue;
    }

    const slug = slugifyCampRef(ref);
    try {
      // Placeholder camp: no boundary/size yet — the farmer completes it
      // post-import. `create` carries the species explicitly (the facade
      // deliberately does not wrap creates — see species-scoped-prisma.ts).
      await prisma.camp.create({
        data: { campId: slug, campName: ref.trim(), species },
      });
      resolvedByKey.set(key, slug);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Concurrent import created it between lookup and create.
        resolvedByKey.set(key, slug);
      } else {
        logger.error("commitImport: failed to create placeholder camp", {
          campId: slug,
          species,
          error: err instanceof Error ? err.message : err,
        });
        failedKeys.add(key);
      }
    }
  }

  const resolvedRows: ValidatedRow[] = [];
  const errors: CommitImportError[] = [];
  for (const row of rows) {
    if (!row.currentCamp) {
      resolvedRows.push(row);
      continue;
    }
    const key = campKey(row.species ?? defaultSpecies, row.currentCamp);
    const campId = resolvedByKey.get(key);
    if (campId === undefined) {
      errors.push({
        row: row.originalIndex,
        earTag: row.earTag,
        reason: "camp could not be created",
      });
      continue;
    }
    resolvedRows.push(
      campId === row.currentCamp ? row : { ...row, currentCamp: campId },
    );
  }
  return { resolvedRows, errors };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function commitImport(
  prisma: PrismaClient,
  input: CommitImportInput,
  onProgress?: (p: CommitImportProgress) => void,
): Promise<CommitImportResult> {
  const { rows, importJobId, defaultSpecies } = input;

  // Caller-contract validation: defaultSpecies is required and must be in the
  // allowlist. This is a programmer error (not a per-row error) so we throw.
  if (!defaultSpecies || !ALLOWED_SPECIES.has(defaultSpecies)) {
    throw new Error("invalid defaultSpecies");
  }

  const total = rows.length;
  const errors: CommitImportError[] = [];

  // Empty-input fast path — still emit a terminal "done" event.
  if (total === 0) {
    onProgress?.({ phase: "done", processed: 0, total: 0 });
    return { inserted: 0, skipped: 0, errors: [] };
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — validate
  // ---------------------------------------------------------------------------
  const { kept: validated, errors: validationErrors } = validateRows(rows, onProgress);
  errors.push(...validationErrors);

  // ---------------------------------------------------------------------------
  // Phase 2 — pedigree topo sort
  // ---------------------------------------------------------------------------
  const { ordered: orderedRaw, errors: pedigreeErrors } = topologicallyOrder(
    validated,
    onProgress,
  );
  errors.push(...pedigreeErrors);

  // ---------------------------------------------------------------------------
  // Phase 2.5 — camp resolution (S12 / H2 / OB-006): reuse existing camps,
  // create species-scoped placeholders for the rest, rewrite currentCamp to
  // the resolved campId so the insert below never dangles.
  // ---------------------------------------------------------------------------
  const { resolvedRows: ordered, errors: campErrors } =
    await resolveReferencedCamps(prisma, orderedRaw, defaultSpecies);
  errors.push(...campErrors);

  // ---------------------------------------------------------------------------
  // Phase 3 — transactional insert
  // ---------------------------------------------------------------------------
  // Resolve existing ear tags to animalId (the ID stored in fatherId/motherId).
  const parentTags = new Set<string>();
  for (const row of ordered) {
    if (row.fatherId) parentTags.add(row.fatherId);
    if (row.motherId) parentTags.add(row.motherId);
  }

  let existingByTag = new Map<string, string>();
  if (parentTags.size > 0) {
    // cross-species by design: ear-tag uniqueness is farm-wide, not per-species.
    const existing = await crossSpecies(
      prisma,
      "species-registry-internal",
    ).animal.findMany({
      where: { animalId: { in: Array.from(parentTags) } },
      select: { animalId: true },
    });
    existingByTag = new Map(existing.map((a) => [a.animalId, a.animalId]));
  }

  // Earliest earTag resolutions as we insert in topological order.
  const resolvedByTag = new Map<string, string>(existingByTag);

  let inserted = 0;
  const todayIso = new Date().toISOString().split("T")[0];

  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i];

        const resolvedSire =
          row.fatherId && resolvedByTag.has(row.fatherId)
            ? resolvedByTag.get(row.fatherId)!
            : null;
        const resolvedDam =
          row.motherId && resolvedByTag.has(row.motherId)
            ? resolvedByTag.get(row.motherId)!
            : null;

        try {
          await tx.animal.create({
            data: {
              animalId: row.earTag,
              sex: row.sex ?? "Unknown",
              dateOfBirth: row.dateOfBirthIso ?? null,
              breed: row.breed ?? "Mixed",
              category: row.category ?? "Unknown",
              currentCamp: row.currentCamp ?? UNASSIGNED_CAMP,
              status: row.status ?? "Active",
              registrationNumber: row.registrationNumber ?? null,
              deceasedAt: row.deceasedAtIso ?? null,
              motherId: resolvedDam,
              fatherId: resolvedSire,
              dateAdded: todayIso,
              species: row.species ?? defaultSpecies,
              importJobId,
              // Unresolved-ref note wins; otherwise pass through any
              // wizard-provided free-text note for the same slot.
              sireNote: row.fatherId && !resolvedByTag.has(row.fatherId)
                ? `Unresolved sire: ${row.fatherId}`
                : row.sireNote ?? null,
              damNote: row.motherId && !resolvedByTag.has(row.motherId)
                ? `Unresolved dam: ${row.motherId}`
                : row.damNote ?? null,
            },
          });
          inserted += 1;
          resolvedByTag.set(row.earTag, row.earTag);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown insert error";
          errors.push({
            row: row.originalIndex,
            earTag: row.earTag,
            reason,
          });
        }

        if ((i + 1) % INSERT_PROGRESS_INTERVAL === 0) {
          onProgress?.({
            phase: "inserting",
            processed: i + 1,
            total: ordered.length,
          });
        }
      }

      // Terminal tick for inserting phase.
      if (ordered.length > 0) {
        onProgress?.({
          phase: "inserting",
          processed: ordered.length,
          total: ordered.length,
        });
      }
    },
    {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  );

  const skipped = total - inserted;

  // ---------------------------------------------------------------------------
  // Phase 4 — update ImportJob (non-fatal: inserts are already committed)
  // ---------------------------------------------------------------------------
  try {
    await prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: "complete",
        completedAt: new Date(),
        rowsImported: inserted,
        rowsFailed: skipped,
        warnings: errors.length > 0 ? JSON.stringify(errors.slice(0, 100)) : null,
      },
    });
  } catch (err) {
    // Inserts are already committed. Log and move on so the HTTP layer can
    // still report success to the user.
    logger.error("commitImport: failed to update ImportJob", {
      importJobId,
      inserted,
      skipped,
      error: err instanceof Error ? err.message : err,
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 5 — flip onboardingComplete on FarmSettings (non-fatal)
  //
  // I7: the admin layout gate relies on this flag. Without flipping it, a
  // farmer who successfully imports their herd would still bounce back to
  // the onboarding wizard every time they visit /admin. Only flip on a
  // genuine success (at least one row inserted) so a failed import stays
  // in the wizard.
  // ---------------------------------------------------------------------------
  if (inserted > 0) {
    try {
      // FarmSettings uses id: "singleton"; upsert handles the rare case of a
      // tenant with no settings row yet.
      await prisma.farmSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", onboardingComplete: true },
        update: { onboardingComplete: true },
      });
    } catch (err) {
      // Non-fatal: inserts are already committed; the gate simply won't
      // flip for this session. Farmer will re-hit /onboarding, see the
      // "empty farm guard" detect animals > 0, and be redirected to /admin
      // anyway (see app/[farmSlug]/onboarding/layout.tsx).
      logger.error("commitImport: failed to flip FarmSettings.onboardingComplete", {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  onProgress?.({ phase: "done", processed: total, total });

  return { inserted, skipped, errors };
}
