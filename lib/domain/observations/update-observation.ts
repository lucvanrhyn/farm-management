/**
 * Wave C (#156) — domain op `updateObservation`.
 *
 * Mutates the `details` payload on an existing observation row,
 * appending an audit entry to `editHistory` so the prior payload is
 * recoverable. The history array is capped at 50 entries to prevent
 * unbounded row growth (audit-trail invariant carried over from the
 * pre-Wave-C route handler).
 *
 * Throws `ObservationNotFoundError` when the row does not exist; the
 * adapter envelope maps it onto a 404.
 */
import type { Observation, PrismaClient } from "@prisma/client";

import { getMaxLiveWeightKg } from "@/lib/species/breeding-constants";

import { validateObservationDetails } from "./details-schemas";
import { sanitizeNote } from "./create-observation";
import { ObservationNotFoundError } from "./errors";

const MAX_HISTORY_ENTRIES = 50;

export interface UpdateObservationInput {
  id: string;
  details: string;
  /**
   * Issue #492 (PRD #479 backlog) — optional edit to the free-text `notes`
   * column. Edited INDEPENDENTLY of `details`: when the key is OMITTED
   * (`undefined`) the column is left untouched (a details-only edit must not
   * clobber an existing note); when supplied it is sanitised by
   * {@link sanitizeNote} (trim + cap; blank → null; over-length throws
   * `NoteTooLongError` → 400). An explicit `null` clears the note.
   */
  notes?: string | null;
  /** Email of the actor — captured on the audit trail. */
  editedBy: string | null;
}

export async function updateObservation(
  prisma: PrismaClient,
  input: UpdateObservationInput,
): Promise<Observation> {
  const existing = await prisma.observation.findUnique({
    where: { id: input.id },
  });
  if (!existing) {
    throw new ObservationNotFoundError(input.id);
  }

  // ADR-0007 (#513) — per-type `details` validation at the EDIT boundary, via
  // the same schema registry the create door uses (`validateObservationDetails`).
  // The existing row already carries the stamped `species` (written at create
  // time by the ADR-0006 waterfall), so weighing's cap is species-correct.
  // Validate the INCOMING `details` before persisting, so a stale / malicious
  // PATCH cannot edit a clean payload into a garbage one (e.g. a 999,999 kg
  // weight, or a death edited to drop its carcassDisposal). An unregistered
  // type (or a legacy row with no `type`) is a no-op (pass-through);
  // `getMaxLiveWeightKg` is throw-free for a null/unknown species.
  validateObservationDetails(existing.type, input.details, {
    speciesMax: getMaxLiveWeightKg(existing.species),
  });

  // Issue #492 — sanitise the edited note BEFORE building the update, so an
  // over-length note throws NoteTooLongError and nothing is written. The
  // `notes` key is included in the update data ONLY when the caller supplied
  // it: an omitted key leaves the column untouched (a details-only edit must
  // not clobber an existing note); an explicit `null` clears it.
  const notesEdited = "notes" in input;
  const sanitizedNotes = notesEdited ? sanitizeNote(input.notes) : null;

  const previousHistory: unknown[] = existing.editHistory
    ? (JSON.parse(existing.editHistory) as unknown[])
    : [];
  const rawHistory = [
    ...previousHistory,
    {
      editedBy: input.editedBy ?? "unknown",
      editedAt: new Date().toISOString(),
      previousDetails: existing.details,
    },
  ];
  const newHistory = rawHistory.slice(-MAX_HISTORY_ENTRIES);

  return prisma.observation.update({
    where: { id: input.id },
    data: {
      details: input.details,
      editedBy: input.editedBy,
      editedAt: new Date(),
      editHistory: JSON.stringify(newHistory),
      ...(notesEdited ? { notes: sanitizedNotes } : {}),
    },
  });
}
