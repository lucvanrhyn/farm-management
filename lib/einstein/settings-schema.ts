/**
 * lib/einstein/settings-schema.ts — canonical shape + parse helpers for the
 * `FarmSettings.aiSettings` JSON blob (Phase L Wave 1 schema, referenced by
 * lib/einstein/budget.ts and the Wave 3E UI / API layer).
 *
 * Rationale for centralising here: the same blob is read by
 *   - `app/[farmSlug]/admin/layout.tsx` (for assistantName → AssistantNameProvider)
 *   - `app/[farmSlug]/admin/einstein/page.tsx` (header wordmark)
 *   - `app/[farmSlug]/admin/settings/ai/page.tsx` (rename + language + budget)
 *   - `app/[farmSlug]/admin/settings/methodology/page.tsx` (Farm Methodology Object)
 *   - `app/api/[farmSlug]/farm-settings/ai/route.ts`
 *   - `app/api/[farmSlug]/farm-settings/methodology/route.ts`
 *   - `lib/einstein/budget.ts` (runtime budget stamping)
 *
 * One parse helper + one merge helper keeps the shape invariant-checked in a
 * single place. Server callers treat any field they don't understand as
 * opaque to preserve forward-compat with future Phase-L waves.
 */

import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_BUDGET_CAP_ZAR,
  DEFAULT_RESPONSE_LANGUAGE,
} from './defaults';

/** Language choices a farmer may pick for Einstein's reply language. */
export type ResponseLanguage = 'en' | 'af' | 'auto';

/**
 * Farm Methodology Object — the opinionated narrative the LLM gets as context
 * so it "thinks like this farm". All fields are string-shaped for v1 so the
 * editor is a single freeform form; Wave 4+ may swap individual subtrees for
 * structured editors.
 */
export interface FarmMethodology {
  /** Short tier descriptor ("commercial mixed cow-calf", "stud operation"). */
  readonly tier?: string;
  readonly speciesMix?: string;
  readonly breedingCalendar?: string;
  readonly rotationPolicy?: string;
  readonly lsuThresholds?: string;
  readonly farmerNotes?: string;
}

/** RAG budget + kill-switch config (also managed by lib/einstein/budget.ts). */
export interface RagConfig {
  readonly enabled: boolean;
  readonly budgetCapZarPerMonth: number;
  readonly monthSpentZar: number;
  readonly currentMonthKey: string;
}

/** Full aiSettings blob. Every field optional — blob may be missing. */
export interface AiSettings {
  readonly assistantName?: string;
  readonly responseLanguage?: ResponseLanguage;
  readonly methodology?: FarmMethodology;
  readonly ragConfig?: RagConfig;
  // Additional keys we don't control (learnedPreferences, future telemetry)
  // are passed through untouched by the merge helper below.
  readonly [extra: string]: unknown;
}

/**
 * Parse the raw column value from Prisma into an `AiSettings` object. Any
 * parse failure collapses to an empty object — never throws so UI surfaces
 * can always render something.
 */
export function parseAiSettings(raw: string | null | undefined): AiSettings {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as AiSettings;
  } catch {
    return {};
  }
}

/**
 * Merge a partial patch into an existing blob WITHOUT clobbering keys the
 * caller did not specify. Nested objects (methodology, ragConfig) are also
 * shallow-merged so the /ai route doesn't wipe methodology and vice versa.
 *
 * Returns a fresh object (immutable patterns — never mutates inputs).
 */
export function mergeAiSettings(
  existing: AiSettings,
  patch: Partial<AiSettings>,
): AiSettings {
  const next: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      key === 'methodology' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing.methodology &&
      typeof existing.methodology === 'object'
    ) {
      next.methodology = {
        ...existing.methodology,
        ...(value as FarmMethodology),
      };
    } else if (
      key === 'ragConfig' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing.ragConfig &&
      typeof existing.ragConfig === 'object'
    ) {
      next.ragConfig = {
        ...existing.ragConfig,
        ...(value as RagConfig),
      };
    } else {
      next[key] = value;
    }
  }
  return next as AiSettings;
}

/** Default values used by the editor forms when a field is missing. */
export function effectiveAssistantName(blob: AiSettings): string {
  const raw = blob.assistantName;
  if (typeof raw !== 'string') return DEFAULT_ASSISTANT_NAME;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ASSISTANT_NAME;
}

export function effectiveResponseLanguage(blob: AiSettings): ResponseLanguage {
  const raw = blob.responseLanguage;
  if (raw === 'en' || raw === 'af' || raw === 'auto') return raw;
  return DEFAULT_RESPONSE_LANGUAGE;
}

export function effectiveBudgetCap(blob: AiSettings): number {
  const cap = blob.ragConfig?.budgetCapZarPerMonth;
  if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
  return DEFAULT_BUDGET_CAP_ZAR;
}

/** Validation regex for rename input (1–32 chars after trim, safe charset). */
export const ASSISTANT_NAME_REGEX = /^[A-Za-z0-9 .'-]+$/;
export const ASSISTANT_NAME_MAX_LEN = 32;

export function validateAssistantName(raw: unknown): string | null {
  // Empty string = reset to default, handled by caller. Here null means OK
  // (default), a string means a specific name was requested.
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null; // explicit reset
  if (trimmed.length > ASSISTANT_NAME_MAX_LEN) {
    throw new Error(`assistantName exceeds ${ASSISTANT_NAME_MAX_LEN} characters`);
  }
  if (!ASSISTANT_NAME_REGEX.test(trimmed)) {
    throw new Error('assistantName contains invalid characters');
  }
  return trimmed;
}

/** Budget-cap override bounds. */
export const BUDGET_CAP_MIN_ZAR = 10;
export const BUDGET_CAP_MAX_ZAR = 1000;
