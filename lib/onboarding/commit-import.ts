/**
 * B4a — commitImport library
 * -----------------------------------------------------------------------------
 * Takes a mapped-and-validated import payload and writes it to the database.
 * The calling HTTP route (B4b) wraps this with auth + SSE streaming.
 *
 * Pipeline:
 *  1. Validation   — de-dupe within batch, check earTag/birthDate/sex
 *  2. Pedigree     — topological sort so sires/dams are inserted first,
 *                    detect cycles, prune affected rows
 *  3. Inserting    — transactional prisma.animal.create per row; per-row
 *                    failures are captured as errors (not aborts)
 *  4. Done         — update ImportJob with final counts
 *
 * Schema note: this repo's Animal model stores parent ear-tag strings in
 * `fatherId`/`motherId` (no FK). The public ImportRow API mirrors the task
 * spec (`earTag`, `sireEarTag`, `damEarTag`, ...) and we translate to schema
 * names at insert time. Pedigree resolution still runs a topological sort
 * so cycles are rejected and ordering is deterministic.
 *
 * ImportJob fields used: `rowsImported`, `rowsFailed`, `warnings`, `status`,
 * `completedAt`.
 */

import type { PrismaClient } from "@prisma/client";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ImportRow = {
  earTag: string; // required, unique per animal within farm
  sex?: "Male" | "Female";
  birthDate?: Date | string; // ISO or Date
  breed?: string;
  campId?: string; // must reference existing camp.campId
  sireEarTag?: string; // pedigree — may reference another row in THIS import
  damEarTag?: string; // pedigree — may reference another row in THIS import
  notes?: string;
  species?: string; // per-row override of defaultSpecies; validated against ALLOWED_SPECIES
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

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

type ValidatedRow = {
  /** Index in the original input.rows array (1-based for reporting). */
  originalIndex: number;
  earTag: string;
  sex?: "Male" | "Female";
  birthDateIso?: string;
  breed?: string;
  campId?: string;
  sireEarTag?: string;
  damEarTag?: string;
  notes?: string;
  /** Resolved per-row species (row.species if valid, else undefined — caller applies defaultSpecies at insert). */
  species?: string;
};

function parseBirthDate(value: Date | string): string | null {
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
    const row = rows[i];
    const rowNum = i + 1;
    const rawEarTag = typeof row.earTag === "string" ? row.earTag.trim() : "";

    if (!rawEarTag) {
      errors.push({ row: rowNum, reason: "missing earTag" });
    } else if (seenEarTags.has(rawEarTag)) {
      errors.push({
        row: rowNum,
        earTag: rawEarTag,
        reason: "duplicate earTag within import",
      });
    } else if (row.sex !== undefined && row.sex !== "Male" && row.sex !== "Female") {
      errors.push({ row: rowNum, earTag: rawEarTag, reason: "invalid sex" });
    } else if (
      row.species !== undefined &&
      row.species !== null &&
      row.species !== "" &&
      !ALLOWED_SPECIES.has(row.species)
    ) {
      errors.push({ row: rowNum, earTag: rawEarTag, reason: "invalid species" });
    } else {
      let birthDateIso: string | undefined;
      if (row.birthDate !== undefined && row.birthDate !== null && row.birthDate !== "") {
        const parsed = parseBirthDate(row.birthDate);
        if (parsed === null) {
          errors.push({ row: rowNum, earTag: rawEarTag, reason: "invalid birthDate" });
          // Emit progress before continuing
          if ((i + 1) % VALIDATE_PROGRESS_INTERVAL === 0) {
            onProgress?.({ phase: "validating", processed: i + 1, total: rows.length });
          }
          continue;
        }
        birthDateIso = parsed;
      }

      const resolvedSpecies =
        row.species && ALLOWED_SPECIES.has(row.species) ? row.species : undefined;

      seenEarTags.add(rawEarTag);
      kept.push({
        originalIndex: rowNum,
        earTag: rawEarTag,
        sex: row.sex,
        birthDateIso,
        breed: row.breed,
        campId: row.campId,
        sireEarTag: row.sireEarTag?.trim() || undefined,
        damEarTag: row.damEarTag?.trim() || undefined,
        notes: row.notes,
        species: resolvedSpecies,
      });
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
 * Rows with a sire/dam that references an ear tag not in this batch are
 * unaffected by ordering — they rely on existing DB state, which the insert
 * phase validates.
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
    if (row.sireEarTag && byEarTag.has(row.sireEarTag)) parents.add(row.sireEarTag);
    if (row.damEarTag && byEarTag.has(row.damEarTag)) parents.add(row.damEarTag);

    // Self-reference is a trivial cycle.
    if (parents.has(row.earTag)) {
      // handled below in cycle detection; for now include it
    }
    inBatchParents.set(row.earTag, parents);
    if (parents.size > 0 || row.sireEarTag || row.damEarTag) {
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
  const { ordered, errors: pedigreeErrors } = topologicallyOrder(validated, onProgress);
  errors.push(...pedigreeErrors);

  // ---------------------------------------------------------------------------
  // Phase 3 — transactional insert
  // ---------------------------------------------------------------------------
  // Resolve existing ear tags to animalId (the ID stored in fatherId/motherId).
  const parentTags = new Set<string>();
  for (const row of ordered) {
    if (row.sireEarTag) parentTags.add(row.sireEarTag);
    if (row.damEarTag) parentTags.add(row.damEarTag);
  }

  let existingByTag = new Map<string, string>();
  if (parentTags.size > 0) {
    const existing = await prisma.animal.findMany({
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

        const fatherId =
          row.sireEarTag && resolvedByTag.has(row.sireEarTag)
            ? resolvedByTag.get(row.sireEarTag)!
            : row.sireEarTag
              ? null
              : null;
        const motherId =
          row.damEarTag && resolvedByTag.has(row.damEarTag)
            ? resolvedByTag.get(row.damEarTag)!
            : row.damEarTag
              ? null
              : null;

        try {
          await tx.animal.create({
            data: {
              animalId: row.earTag,
              sex: row.sex ?? "Unknown",
              dateOfBirth: row.birthDateIso ?? null,
              breed: row.breed ?? "Mixed",
              category: "Unknown",
              currentCamp: row.campId ?? "unassigned",
              status: "Active",
              motherId,
              fatherId,
              dateAdded: todayIso,
              species: row.species ?? defaultSpecies,
              importJobId,
              sireNote: row.sireEarTag && !resolvedByTag.has(row.sireEarTag)
                ? `Unresolved sire: ${row.sireEarTag}`
                : null,
              damNote: row.damEarTag && !resolvedByTag.has(row.damEarTag)
                ? `Unresolved dam: ${row.damEarTag}`
                : null,
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
    // eslint-disable-next-line no-console
    console.error("commitImport: failed to update ImportJob", {
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
      // eslint-disable-next-line no-console
      console.error("commitImport: failed to flip FarmSettings.onboardingComplete", {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  onProgress?.({ phase: "done", processed: total, total });

  return { inserted, skipped, errors };
}
