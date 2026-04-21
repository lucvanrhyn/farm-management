/**
 * Shared types + defaults for the farm task settings blob. Kept outside the
 * route file because Next.js 16 only permits route-handler exports
 * (HTTP methods, `runtime`, `dynamic`, etc.) from `route.ts`.
 */

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

export function parseStoredTaskSettings(
  raw: string | null | undefined,
): FarmTaskSettings {
  if (!raw) return DEFAULT_TASK_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmTaskSettings>;
    return {
      defaultReminderOffset:
        typeof parsed.defaultReminderOffset === "number" &&
        parsed.defaultReminderOffset >= 0
          ? Math.round(parsed.defaultReminderOffset)
          : DEFAULT_TASK_SETTINGS.defaultReminderOffset,
      autoObservation:
        typeof parsed.autoObservation === "boolean"
          ? parsed.autoObservation
          : DEFAULT_TASK_SETTINGS.autoObservation,
      horizonDays:
        parsed.horizonDays === 30 ||
        parsed.horizonDays === 60 ||
        parsed.horizonDays === 90
          ? parsed.horizonDays
          : DEFAULT_TASK_SETTINGS.horizonDays,
    };
  } catch {
    // Silent-failure cure: if stored JSON is corrupt, fall back to defaults
    // rather than throwing — admin can overwrite via PUT.
    return DEFAULT_TASK_SETTINGS;
  }
}
