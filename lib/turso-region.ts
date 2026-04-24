/**
 * Turso region parsing + classification.
 *
 * Used by Phase E (Frankfurt region migration) to:
 *  - Classify each farm's Turso URL by physical region so observability can
 *    differentiate requests served from Tokyo vs. Frankfurt during the
 *    cutover window.
 *  - Gate the meta-DB smoke test (`assertAllFarmsInRegion`) that guards
 *    against silently provisioning a farm into the wrong region after
 *    cutover.
 *
 * Intentionally NOT a runtime router: Turso's libSQL client handles
 * read/write routing natively when replicas exist. This module is pure
 * string logic — no I/O, no network, no libSQL dependency.
 */

export type TursoRegion = "fra" | "nrt" | "iad";

export const TURSO_REGIONS: ReadonlyArray<{
  code: TursoRegion;
  awsRegion: string;
  description: string;
}> = [
  { code: "fra", awsRegion: "eu-central-1", description: "Frankfurt (Phase E target)" },
  { code: "nrt", awsRegion: "ap-northeast-1", description: "Tokyo (pre-Phase-E)" },
  { code: "iad", awsRegion: "us-east-1", description: "US East (legacy)" },
] as const;

const REGION_BY_AWS = new Map(
  TURSO_REGIONS.map((r) => [r.awsRegion.toLowerCase(), r.code] as const),
);

// Matches `.aws-<region>.turso.io` inside a libSQL hostname. Anchored on the
// `.aws-` prefix + `.turso.io` suffix so arbitrary subdomains like
// `trio-b-boerdery-lucvanrhyn` in the farm slug don't accidentally match a
// region name.
const AWS_REGION_RE = /\.aws-([a-z0-9-]+)\.turso\.io$/i;

/**
 * Parse a Turso/libSQL URL and return the short region code (fra/nrt/iad).
 * Returns null if the URL is malformed or the region is unknown.
 */
export function parseTursoRegion(url: string): TursoRegion | null {
  if (!url) return null;
  let hostname: string;
  try {
    // Accept libsql://, https://, http:// — URL() rejects unknown schemes
    // but libsql:// is registered as a valid scheme pattern by the browser
    // URL parser in Node 18+. Fall through to a regex-based extraction if
    // URL construction fails for any reason.
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  const match = hostname.match(/\.aws-([a-z0-9-]+)\.turso\.io$/i);
  if (!match) return null;
  const awsRegion = match[1].toLowerCase();
  return REGION_BY_AWS.get(awsRegion) ?? null;
}

/**
 * True when the URL parses to the expected region. Convenience wrapper for
 * meta-DB smoke assertions.
 */
export function isTargetRegion(url: string, expected: TursoRegion): boolean {
  return parseTursoRegion(url) === expected;
}

export interface FarmRegionCheckInput {
  slug: string;
  tursoUrl: string;
}

export interface FarmRegionOffender {
  slug: string;
  tursoUrl: string;
  actualRegion: TursoRegion | null;
}

export interface FarmRegionCheckResult {
  ok: boolean;
  target: TursoRegion;
  offending: FarmRegionOffender[];
}

/**
 * Given a list of `{ slug, tursoUrl }` pairs (normally pulled from the meta
 * DB), classify each by region and report any farm that isn't in `target`.
 *
 * Used by Phase E's CI-time smoke check and the `scripts/verify-farm-regions.ts`
 * runbook step. Pure function — the caller owns the meta-DB read so this
 * module stays environment-free and trivially testable.
 */
export function assertAllFarmsInRegion(
  farms: ReadonlyArray<FarmRegionCheckInput>,
  target: TursoRegion,
): FarmRegionCheckResult {
  const offending: FarmRegionOffender[] = [];
  for (const farm of farms) {
    const actualRegion = parseTursoRegion(farm.tursoUrl);
    if (actualRegion !== target) {
      offending.push({ slug: farm.slug, tursoUrl: farm.tursoUrl, actualRegion });
    }
  }
  return { ok: offending.length === 0, target, offending };
}
