/**
 * lib/server/revalidate.ts
 *
 * Thin wrappers that call `revalidateTag` with the correct farm-scoped tags
 * after a successful DB write. Import one of these in every mutation route —
 * never call `revalidateTag` with raw strings.
 *
 * All helpers accept the farm slug so they work both in URL-scoped routes
 * (slug from params) and in shared routes (slug from session / getPrismaWithAuth).
 */

import { revalidateTag } from "next/cache";
import {
  animalWriteTags,
  observationWriteTags,
  campWriteTags,
  mobWriteTags,
  taskWriteTags,
  settingsWriteTags,
  transactionWriteTags,
  alertWriteTags,
  rotationWriteTags,
  farmTag,
} from "./cache-tags";

// Next.js 16 revalidateTag requires a second "profile" argument.
// "max" means: purge all cache entries with this tag immediately.
const REVALIDATE_PROFILE = "max" as const;

/** Animal create / update / delete / import */
export function revalidateAnimalWrite(slug: string): void {
  for (const tag of animalWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Observation create / update / delete / attachment */
export function revalidateObservationWrite(slug: string): void {
  for (const tag of observationWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Camp create / update / delete / cover */
export function revalidateCampWrite(slug: string): void {
  for (const tag of campWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Mob create / update / delete + animal-in-mob changes */
export function revalidateMobWrite(slug: string): void {
  for (const tag of mobWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Task create / update / delete */
export function revalidateTaskWrite(slug: string): void {
  for (const tag of taskWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Farm / species settings, map config, alert thresholds, AI settings,
 * methodology, billing tier display.
 */
export function revalidateSettingsWrite(slug: string): void {
  for (const tag of settingsWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Transaction / budget / category writes */
export function revalidateTransactionWrite(slug: string): void {
  for (const tag of transactionWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Alert rule changes */
export function revalidateAlertWrite(slug: string): void {
  for (const tag of alertWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Rotation plan / step / execute */
export function revalidateRotationWrite(slug: string): void {
  for (const tag of rotationWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Broad nuke — invalidates all cached data for a farm.
 * Only use for global operations like /admin/reset or reset endpoints.
 */
export function revalidateFarmAll(slug: string): void {
  revalidateTag(farmTag(slug, "all"), REVALIDATE_PROFILE);
}
