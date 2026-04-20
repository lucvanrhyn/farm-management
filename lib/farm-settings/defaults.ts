/**
 * Farm-level settings shapes + defaults for Phase K admin settings.
 *
 * Extracted from the route files because Next.js App Router rejects any
 * non-handler export from a `route.ts` module (only HTTP verbs + specific
 * config symbols like `revalidate`, `dynamic`, `runtime` are allowed). A
 * bare `export const DEFAULT_*_SETTINGS` on a route breaks `next build`
 * with "not a valid Route export field" — caught in PR #6 prod deploy.
 *
 * Single source of truth — imported by:
 *   - app/api/farm-settings/{map,tasks}/route.ts (handlers)
 *   - app/[farmSlug]/admin/settings/{map,tasks}/page.tsx (server renderers)
 *   - components/admin/{map,tasks}/*Client.tsx (client state init)
 */

// ── Map settings ──────────────────────────────────────────────────────────

export interface FarmMapSettings {
  eskomAreaId: string | null;
}

export const DEFAULT_MAP_SETTINGS: FarmMapSettings = {
  eskomAreaId: null,
};

export function parseStoredMapSettings(raw: string | null | undefined): FarmMapSettings {
  if (!raw) return DEFAULT_MAP_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmMapSettings>;
    return {
      eskomAreaId:
        typeof parsed.eskomAreaId === "string" && parsed.eskomAreaId.trim()
          ? parsed.eskomAreaId.trim()
          : null,
    };
  } catch {
    // Silent-failure cure: corrupt blob → defaults; admin overwrites via PUT.
    return DEFAULT_MAP_SETTINGS;
  }
}

// ── Task settings ─────────────────────────────────────────────────────────

export interface FarmTaskSettings {
  defaultReminderOffset: number;
  autoObservation: boolean;
  horizonDays: 30 | 60 | 90;
}

export const DEFAULT_TASK_SETTINGS: FarmTaskSettings = {
  defaultReminderOffset: 1440, // 24h
  autoObservation: true,
  horizonDays: 30,
};

export function parseStoredTaskSettings(raw: string | null | undefined): FarmTaskSettings {
  if (!raw) return DEFAULT_TASK_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmTaskSettings>;
    return {
      defaultReminderOffset:
        typeof parsed.defaultReminderOffset === "number" && parsed.defaultReminderOffset >= 0
          ? Math.round(parsed.defaultReminderOffset)
          : DEFAULT_TASK_SETTINGS.defaultReminderOffset,
      autoObservation:
        typeof parsed.autoObservation === "boolean"
          ? parsed.autoObservation
          : DEFAULT_TASK_SETTINGS.autoObservation,
      horizonDays:
        parsed.horizonDays === 30 || parsed.horizonDays === 60 || parsed.horizonDays === 90
          ? parsed.horizonDays
          : DEFAULT_TASK_SETTINGS.horizonDays,
    };
  } catch {
    // Silent-failure cure: corrupt blob → defaults; admin overwrites via PUT.
    return DEFAULT_TASK_SETTINGS;
  }
}
