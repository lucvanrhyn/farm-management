/**
 * lib/flags.ts
 *
 * Feature flags for progressive rollout of structural changes.
 *
 * FARM_CACHE_ENABLED_SLUGS — controls which farm tenants use unstable_cache
 * for expensive server-component data fetches instead of hitting the DB on
 * every request.
 *
 * Accepted values:
 *   (unset)                — caching disabled for all farms (safe default)
 *   "*"                    — caching enabled for all farms
 *   "trio-b,acme-cattle" — comma-separated allowlist
 *
 * Rollout sequence:
 *   1. Deploy with FARM_CACHE_ENABLED_SLUGS unset (flag off everywhere)
 *   2. Set to "trio-b" → verify LHCI budgets + watch Vercel function durations
 *   3. Set to "trio-b,acme-cattle" → 1 h soak → check error rates
 *   4. Set to "*" → monitor for 24 h
 *   5. Delete this file + all isCacheEnabled() branches after one clean week
 *
 * Design note: per-slug granularity (rather than a simple boolean) lets us
 * stage rollout across tenants independently without a deployment per tenant.
 * At 2 tenants this is lightweight; at 20+ it becomes essential.
 */

let _parsed: Set<string> | "*" | null = null;

function parseAllowlist(): Set<string> | "*" {
  if (_parsed !== null) return _parsed;

  const raw = process.env.FARM_CACHE_ENABLED_SLUGS?.trim();
  if (!raw) {
    _parsed = new Set<string>();
    return _parsed;
  }
  if (raw === "*") {
    _parsed = "*";
    return _parsed;
  }
  _parsed = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return _parsed;
}

/**
 * Returns true when the unstable_cache data layer should be used for the
 * given farm slug. False → fall back to live DB queries (old behaviour).
 */
export function isCacheEnabled(slug: string): boolean {
  const list = parseAllowlist();
  return list === "*" || list.has(slug);
}

// Test-only: reset memoised parse state (allows env-var overrides in tests).
export function __resetFlagCache(): void {
  _parsed = null;
}
