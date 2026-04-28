/**
 * Daily ops summary for Option C (Turso per-branch DB clone provisioner).
 *
 * Lists all active branch clones from the meta-DB, computes age and staleness,
 * and prints a compact human-readable report. Purely informational — exits 0
 * regardless of stale count.
 *
 * Usage:
 *   pnpm ops:daily-summary
 *
 * Required env vars (when run with the production meta-DB):
 *   META_TURSO_URL          — libsql URL of the meta-DB
 *   META_TURSO_AUTH_TOKEN   — auth token for the meta-DB
 */

import { listBranchClones } from '@/lib/meta-db';
import type { BranchCloneRecord } from '@/lib/meta-db';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DailySummaryDeps {
  /** Injectable list function. Defaults to the real listBranchClones. */
  listBranchClonesImpl?: typeof listBranchClones;
  /** Injectable clock. Defaults to () => new Date(). */
  now?: () => Date;
  /** Injectable log function. Defaults to console.log. */
  log?: (line: string) => void;
}

/** Age in hours after which a clone is considered stale. */
const STALE_THRESHOLD_HOURS = 168; // 7 days

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Pad or truncate a string to a fixed width. Left-aligns with spaces. */
function col(value: string, width: number): string {
  if (value.length > width) return value.slice(0, width);
  return value.padEnd(width, ' ');
}

/** Format decimal hours as "3.2h" */
function formatHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

/** Format an ISO timestamp to just the date portion, or '—' if null. */
function formatPromotion(isoOrNull: string | null): string {
  if (!isoOrNull) return '—';
  // Return yyyy-mm-dd portion
  return isoOrNull.slice(0, 10);
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Run the daily ops summary and return an exit code.
 * Always returns 0 — the report is informational only.
 */
export async function runDailySummary(deps?: DailySummaryDeps): Promise<number> {
  const {
    listBranchClonesImpl = listBranchClones,
    now = () => new Date(),
    log = (line: string) => console.log(line),
  } = deps ?? {};

  const currentDate = now();
  const rows: BranchCloneRecord[] = await listBranchClonesImpl();

  // ── Header ─────────────────────────────────────────────────────────────────
  log(`Option C — daily ops summary (UTC: ${currentDate.toISOString()})`);
  log(`Active branch clones: ${rows.length}`);

  if (rows.length === 0) {
    return 0;
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  log('');

  const BRANCH_W = 34;
  const AGE_W = 7;
  const PROMOTED_W = 11;
  const STATUS_W = 6;

  // Column headers
  log(
    `  ${col('branch', BRANCH_W)}  ${col('age', AGE_W)}  ${col('promoted', PROMOTED_W)}  ${col('status', STATUS_W)}`,
  );

  // Separator line
  log(
    `  ${'─'.repeat(BRANCH_W)}  ${'─'.repeat(AGE_W)}  ${'─'.repeat(PROMOTED_W)}  ${'─'.repeat(STATUS_W)}`,
  );

  let staleCount = 0;

  for (const row of rows) {
    const ageMs = currentDate.getTime() - new Date(row.createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const isStale = ageHours > STALE_THRESHOLD_HOURS;

    if (isStale) staleCount++;

    const status = isStale ? 'STALE' : 'fresh';
    const promotedDisplay = formatPromotion(row.lastPromotedAt);
    const ageDisplay = formatHours(ageHours);

    log(
      `  ${col(row.branchName, BRANCH_W)}  ${col(ageDisplay, AGE_W)}  ${col(promotedDisplay, PROMOTED_W)}  ${col(status, STATUS_W)}`,
    );
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  log('');
  log(`Stale clones (>7d): ${staleCount}`);

  if (staleCount > 0) {
    log('Recommend destroying or refreshing stale clones to reduce Turso quota usage.');
  }

  return 0;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

// Only run when this file is the direct entry point (not when imported by tests).
// Uses the same dual CJS/ESM guard as scripts/branch-clone.ts.
(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isCjsMain = typeof require !== 'undefined' && (require as any).main === module;
  const isEsmMain = (() => {
    try {
      const fileUrl = new URL(import.meta.url);
      const argv1 = process.argv[1];
      if (!argv1) return false;
      const argvUrl = new URL(argv1, 'file://');
      return fileUrl.pathname === argvUrl.pathname;
    } catch {
      return false;
    }
  })();

  if (isCjsMain || isEsmMain) {
    try {
      const code = await runDailySummary();
      process.exit(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`ops:daily-summary error: ${message}`);
      process.exit(1);
    }
  }
})();
