// Issue #421 — case-insensitive lookup of a camp by the URL `[campId]`
// segment. Before this fix, the Logger page used strict `===` on
// `c.camp_id === decodedId`, so any casing drift between the URL segment
// and the stored `camp_id` (deep links, shared QR codes, hand-typed URLs)
// produced "Camp not found: <id>" 404s even when the camp existed in
// IndexedDB.
//
// Why the comparison lives here (client) and not in Prisma: the libSQL
// adapter does NOT support `mode: 'insensitive'` on string fields in a
// Prisma `where` clause — invoking it throws at query time. The Logger
// reads camps from IndexedDB via `useOffline().camps` anyway, so the
// comparison naturally belongs on the client. Do not "fix" this by
// pushing the comparison to the server with `mode: 'insensitive'`.
//
// The function is total: returns `undefined` when no camp matches
// (caller renders the existing "Camp not found" 404 branch).
//
// Lives in `_lib/` (underscore folder = not routed by Next.js) so the
// page.tsx file stays compliant with Next 16's page export contract.

import type { Camp } from "@/lib/types";

export function resolveCampByUrlSegment(
  camps: readonly Camp[],
  segment: string,
): Camp | undefined {
  const target = segment.toLowerCase();
  return camps.find((c) => c.camp_id.toLowerCase() === target);
}
