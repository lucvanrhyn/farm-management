/**
 * Shared types + defaults for the farm map settings blob. Kept outside the
 * route file because Next.js 16 only permits route-handler exports
 * (HTTP methods, `runtime`, `dynamic`, etc.) from `route.ts`.
 */

export interface FarmMapSettings {
  eskomAreaId: string | null;
}

export const DEFAULT_MAP_SETTINGS: FarmMapSettings = {
  eskomAreaId: null,
};

export function parseStoredMapSettings(
  raw: string | null | undefined,
): FarmMapSettings {
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
    return DEFAULT_MAP_SETTINGS;
  }
}
