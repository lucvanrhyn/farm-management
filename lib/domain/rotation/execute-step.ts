/**
 * Wave G2 (#166) — domain op `executeRotationPlanStep`.
 *
 * Executes a pending plan step by:
 *   1. Looking up the step and confirming it belongs to the plan.
 *   2. Resolving the mob to move (caller-supplied or step.mobId fallback).
 *   3. Calling `performMobMove` to actually move animals + log
 *      observations.
 *   4. Marking the step as executed and linking the destination
 *      observation row.
 *
 * Behaviour preserved verbatim from the pre-G2 POST handler — only the
 * "already in camp" string-sniff path is now wrapped in
 * `MobAlreadyInCampError` so `mapApiDomainError` can mint the canonical
 * 409 envelope.
 *
 * Throws (typed):
 *  - `StepNotFoundError`             — step missing or wrong plan
 *  - `StepAlreadyExecutedError`      — step.status !== "pending"
 *  - `MissingMobIdError`             — no mobId supplied + no step default
 *  - `MobAlreadyInCampError`         — performMobMove rejected (mob already there)
 *
 * Re-throws unchanged:
 *  - `MobNotFoundError`              — mapped to 404 "Mob not found" by api-errors
 *  - `CrossSpeciesBlockedError`      — mapped to 422 by api-errors
 *  - any other `Error`               — unmapped → 500 DB_QUERY_FAILED
 */
import type { PrismaClient } from "@prisma/client";

import { MobNotFoundError, performMobMove } from "@/lib/domain/mobs/move-mob";

import {
  MissingMobIdError,
  MobAlreadyInCampError,
  StepAlreadyExecutedError,
  StepNotFoundError,
} from "./errors";

export interface ExecuteRotationPlanStepInput {
  mobId?: unknown;
  /** User email of the actor (used as the observation `loggedBy`). */
  loggedBy?: string | null;
}

export interface ExecuteRotationPlanStepResult {
  step: Awaited<ReturnType<PrismaClient["rotationPlanStep"]["update"]>>;
  move: {
    mobId: string;
    mobName: string;
    sourceCamp: string;
    destCamp: string;
    animalCount: number;
    observedAt: Date;
  };
}

export async function executeRotationPlanStep(
  prisma: PrismaClient,
  planId: string,
  stepId: string,
  input: ExecuteRotationPlanStepInput,
): Promise<ExecuteRotationPlanStepResult> {
  const step = await prisma.rotationPlanStep.findUnique({ where: { id: stepId } });
  if (!step || step.planId !== planId) {
    throw new StepNotFoundError(stepId);
  }
  if (step.status !== "pending") {
    throw new StepAlreadyExecutedError(step.status);
  }

  const candidateMobId =
    typeof input.mobId === "string" && input.mobId.length > 0
      ? input.mobId
      : step.mobId;
  if (typeof candidateMobId !== "string" || candidateMobId.length === 0) {
    throw new MissingMobIdError();
  }

  let moveResult: Awaited<ReturnType<typeof performMobMove>>;
  try {
    moveResult = await performMobMove(prisma, {
      mobId: candidateMobId,
      toCampId: step.campId,
      loggedBy: input.loggedBy ?? null,
    });
  } catch (err) {
    // MobNotFound + CrossSpeciesBlocked re-throw unchanged — both already
    // wired into mapApiDomainError. The "already in camp" path is bare
    // Error from performMobMove; map it to a typed error here so the
    // adapter envelope minter has a class instance to recognise.
    if (err instanceof MobNotFoundError) {
      throw err;
    }
    if (err instanceof Error && err.message.includes("already in camp")) {
      throw new MobAlreadyInCampError(err.message);
    }
    throw err;
  }

  const now = new Date();
  const updatedStep = await prisma.rotationPlanStep.update({
    where: { id: stepId },
    data: {
      status: "executed",
      actualStart: now,
      // Link to the destination observation row (index 1)
      executedObservationId: moveResult.observationIds[1],
    },
  });

  return {
    step: updatedStep,
    move: {
      mobId: moveResult.mobId,
      mobName: moveResult.mobName,
      sourceCamp: moveResult.sourceCamp,
      destCamp: moveResult.destCamp,
      animalCount: moveResult.animalIds.length,
      observedAt: moveResult.observedAt,
    },
  };
}
