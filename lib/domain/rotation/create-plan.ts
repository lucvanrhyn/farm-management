/**
 * Wave G2 (#166) — domain op `createRotationPlan`.
 *
 * Validates input (name non-blank, startDate parseable) and inserts a new
 * `RotationPlan` row with optional embedded `steps`. Steps are created
 * with sequential `sequence` numbers (1-indexed) matching the array order.
 *
 * Throws:
 *  - `MissingFieldError({ field: "name" })`       — name missing
 *  - `BlankNameError`                              — name trimmed to empty
 *  - `MissingFieldError({ field: "startDate" })`  — startDate missing
 *  - `InvalidDateError({ field: "startDate" })`   — startDate unparseable
 */
import type { PrismaClient } from "@prisma/client";

import { InvalidDateError, MissingFieldError } from "./errors";

export interface CreateRotationPlanStepInput {
  campId: string;
  mobId?: string;
  plannedStart: string;
  plannedDays: number;
  notes?: string;
}

export interface CreateRotationPlanInput {
  name?: unknown;
  startDate?: unknown;
  notes?: unknown;
  steps?: ReadonlyArray<CreateRotationPlanStepInput>;
}

export async function createRotationPlan(
  prisma: PrismaClient,
  input: CreateRotationPlanInput,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlan"]["create"]>>> {
  if (input.name === undefined || input.name === null || typeof input.name !== "string") {
    throw new MissingFieldError("name");
  }
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    // Pre-G2 wire emitted "name is required" for both blank-after-trim and
    // missing — but the domain semantics differ. Keep the missing-vs-blank
    // distinction in typed errors; mapApiDomainError surfaces both as 400.
    throw new MissingFieldError("name");
  }

  if (
    input.startDate === undefined ||
    input.startDate === null ||
    typeof input.startDate !== "string"
  ) {
    throw new MissingFieldError("startDate");
  }
  const startDate = new Date(input.startDate);
  if (Number.isNaN(startDate.getTime())) {
    throw new InvalidDateError("startDate");
  }

  const notes = typeof input.notes === "string" ? input.notes : null;
  const steps = input.steps?.length
    ? {
        create: input.steps.map((s, i) => ({
          sequence: i + 1,
          campId: s.campId,
          mobId: s.mobId ?? null,
          plannedStart: new Date(s.plannedStart),
          plannedDays: s.plannedDays,
          notes: s.notes ?? null,
        })),
      }
    : undefined;

  return prisma.rotationPlan.create({
    data: {
      name: trimmedName,
      startDate,
      notes,
      steps,
    },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
}

