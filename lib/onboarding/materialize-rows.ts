/**
 * lib/onboarding/materialize-rows.ts
 *
 * S11 (H1/OB-001) — typed row materializer for the import wizard's commit step.
 *
 * Builds `ImportRow[]` from raw spreadsheet rows by applying:
 *   1. The AI's proposal.mapping (filtered by a non-empty target)
 *   2. User mappingOverrides on top (per-source key wins over the AI default)
 *   3. User unmappedOverrides merged in (source columns the AI left blank)
 *
 * Any target equal to "__ignored__" drops that source column. Only canonical
 * `IMPORT_ROW_FIELDS` targets are materialized — the pre-S11 implementation
 * copied ANY target string onto an untyped object and hid the mismatch behind
 * an `as ImportRow` cast, which silently dropped every schema-named field at
 * commit time. The row built here is typed end-to-end; no cast.
 *
 * Hoisted out of `app/[farmSlug]/onboarding/import/page.tsx` so it can be
 * unit-tested: Next 16 page files are restricted to default exports +
 * framework-recognised metadata (see `read-all-rows.ts` for the same move).
 */

import type { ProposalResult } from "@/lib/onboarding/adaptive-import";
import type { ImportRow } from "@/lib/onboarding/commit-import";
import {
  IMPORT_ROW_FIELDS,
  type ImportRowField,
} from "@/lib/onboarding/client-types";

/** Sentinel target used by the mapping UI to drop a source column. */
export const IGNORED_TARGET = "__ignored__";

function isImportRowField(target: string): target is ImportRowField {
  return (IMPORT_ROW_FIELDS as readonly string[]).includes(target);
}

/**
 * Normalize one spreadsheet cell to a trimmed string. Date cells (ExcelJS
 * yields Date objects for date-formatted columns) collapse to ISO YYYY-MM-DD.
 * Empty / blank / invalid-date cells collapse to undefined so downstream
 * validation doesn't reject a row for a `sex` that was never populated.
 */
function toCellString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : value.toISOString().split("T")[0];
  }
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Resolve the effective source-column -> canonical-field mapping. Targets
 * outside the canonical vocabulary (or "__ignored__") are dropped here, NOT
 * silently at commit time.
 */
function buildEffectiveMapping(
  proposal: ProposalResult,
  mappingOverrides: Record<string, string>,
  unmappedOverrides: Record<string, string>,
): Map<string, ImportRowField> {
  const effectiveMap = new Map<string, ImportRowField>();

  for (const m of proposal.proposal.mapping) {
    const target = mappingOverrides[m.source] ?? m.target;
    if (target && target !== IGNORED_TARGET && isImportRowField(target)) {
      effectiveMap.set(m.source, target);
    }
  }
  for (const [source, target] of Object.entries(unmappedOverrides)) {
    if (target && target !== IGNORED_TARGET && isImportRowField(target)) {
      effectiveMap.set(source, target);
    }
  }

  return effectiveMap;
}

/**
 * The effective source-column -> canonical-field mapping as a serializable
 * entry list. This is the SAME filter `materializeRows` applies, exposed so
 * the import page's `mappingJson` audit trail records exactly the mapping
 * that was applied — never a target that was silently dropped.
 */
export function effectiveMappingEntries(
  proposal: ProposalResult,
  mappingOverrides: Record<string, string>,
  unmappedOverrides: Record<string, string>,
): Array<{ source: string; target: ImportRowField }> {
  return Array.from(
    buildEffectiveMapping(proposal, mappingOverrides, unmappedOverrides),
    ([source, target]) => ({ source, target }),
  );
}

/**
 * Materialize every raw row through the approved mapping into the canonical
 * ImportRow vocabulary. An absent ear tag becomes "" so the server rejects
 * that single row with a per-row "missing earTag" error instead of the whole
 * payload failing shape validation.
 */
export function materializeRows(
  rawRows: Record<string, unknown>[],
  proposal: ProposalResult,
  mappingOverrides: Record<string, string>,
  unmappedOverrides: Record<string, string>,
): ImportRow[] {
  const effectiveMap = buildEffectiveMapping(
    proposal,
    mappingOverrides,
    unmappedOverrides,
  );

  return rawRows.map((raw) => {
    const fields: Partial<Record<ImportRowField, string>> = {};
    for (const [src, tgt] of effectiveMap) {
      const cell = toCellString(raw[src]);
      if (cell !== undefined) fields[tgt] = cell;
    }
    const { earTag, ...rest } = fields;
    return { earTag: earTag ?? "", ...rest };
  });
}
