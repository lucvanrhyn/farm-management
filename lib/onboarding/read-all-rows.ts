/**
 * Full-file row reader for the onboarding import wizard's commit step.
 *
 * The wizard's preview only sends 20 sample rows to the AI; the commit step
 * re-reads the entire workbook in the browser and materialises every row
 * before streaming to /api/onboarding/commit-import.
 *
 * Wave 1 W1d removed the `xlsx` package (CVE-2023-30533 + CVE-2024-22363) in
 * favour of ExcelJS via `lib/xlsx-shim`. The previous inline implementation
 * in `app/[farmSlug]/onboarding/import/page.tsx` still did
 * `await import("xlsx")` — invisible to `next build` (dynamic import resolved
 * lazily) but throwing `Cannot find module 'xlsx'` the moment a farmer with
 * > 20 rows clicked "commit". Hoisting to a dedicated module here lets us
 * unit-test the parser without rendering the page (Next.js page.tsx files
 * are restricted to default exports + framework-recognised metadata, so an
 * exported helper directly from the page file fails the build's page
 * contract validation).
 */

import { readFirstSheetAsObjects, readWorkbook } from "@/lib/xlsx-shim";
import { sanitizeRow } from "@/lib/onboarding/parse-file";

export async function readAllRows(
  file: File,
): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = await readWorkbook(buffer);
  // Match SheetJS `sheet_to_json(sheet, { defval: "", raw: false })` semantics
  // exactly so the materialised rows downstream of mapping behave identically
  // to the 20-row preview path which already routes through the shim.
  const rows = readFirstSheetAsObjects(workbook, {
    defval: "",
    raw: false,
  }) as Record<string, unknown>[];
  return rows.map(sanitizeRow);
}
