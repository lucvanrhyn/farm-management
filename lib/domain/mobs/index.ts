/**
 * Wave B (#151) — public surface of the mobs domain ops.
 *
 * Each op is a pure function on `(prisma, input)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantRead`, `adminWrite`) wire
 * these into HTTP route handlers; the typed errors map onto the wire
 * envelope via `mapApiDomainError`.
 *
 * `CrossSpeciesBlockedError`/`CROSS_SPECIES_BLOCKED` are a shared
 * species-isolation invariant (thrown by both the mobs camp-guard and the
 * animals parent-guard), so they are defined in `@/lib/species/errors`
 * (#315) and merely re-exported here as part of the mobs public surface.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-151-mobs-domain-extraction.md`.
 */
export { listMobs, type ListMobsResult } from "./list-mobs";
export { createMob, type CreateMobInput, type CreateMobResult } from "./create-mob";
export { updateMob, type UpdateMobInput, type UpdateMobResult } from "./update-mob";
export { deleteMob, type DeleteMobResult } from "./delete-mob";
export {
  attachAnimalsToMob,
  type AttachAnimalsInput,
  type AttachAnimalsResult,
} from "./attach-animals";
export {
  detachAnimalsFromMob,
  type DetachAnimalsInput,
  type DetachAnimalsResult,
} from "./detach-animals";
export {
  WrongSpeciesError,
  NotFoundError,
  MobHasAnimalsError,
  WRONG_SPECIES,
  NOT_FOUND,
  MOB_HAS_ANIMALS,
} from "./errors";
export {
  performMobMove,
  MobNotFoundError,
  type PerformMobMoveArgs,
  type PerformMobMoveResult,
} from "./move-mob";
export {
  CrossSpeciesBlockedError,
  CROSS_SPECIES_BLOCKED,
} from "@/lib/species/errors";
