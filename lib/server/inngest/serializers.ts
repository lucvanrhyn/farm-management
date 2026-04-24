// lib/server/inngest/serializers.ts — Phase L durable-step boundary helpers.
//
// Inngest persists each `step.run` return value as JSON between steps. Prisma
// model instances and native Date values lose their class shape when they
// cross that boundary (Date → ISO string). Rather than rely on the runtime's
// implicit JSON conversion, we serialize explicitly at each step boundary
// so the types we pass between `evaluate`, `persist`, and `dispatch` are
// spelled out and round-trip safely.
//
// Scope is intentionally narrow: only the two shapes that flow between the
// three durable steps in `evaluateTenantAlerts` — AlertCandidate[] and a
// subset of the Prisma Notification row needed by `dispatchChannels`.

import type { Notification } from "@prisma/client";
import type { AlertCandidate } from "@/lib/server/alerts";

// ---------- AlertCandidate (evaluate → persist) ----------

/**
 * JSON-safe projection of AlertCandidate. The only non-JSON field is
 * `expiresAt: Date`, which we render as an ISO-8601 string. `payload` is an
 * arbitrary JSON object by contract (see lib/server/alerts/types.ts) and
 * survives structuredClone/JSON without transformation.
 */
export interface SerializedAlertCandidate {
  type: string;
  category: AlertCandidate["category"];
  severity: AlertCandidate["severity"];
  dedupKey: string;
  collapseKey: string | null;
  payload: Record<string, unknown>;
  message: string;
  href: string;
  expiresAt: string; // ISO-8601
}

export function serializeCandidates(
  candidates: AlertCandidate[],
): SerializedAlertCandidate[] {
  return candidates.map((c) => ({
    type: c.type,
    category: c.category,
    severity: c.severity,
    dedupKey: c.dedupKey,
    collapseKey: c.collapseKey,
    payload: c.payload,
    message: c.message,
    href: c.href,
    expiresAt: c.expiresAt.toISOString(),
  }));
}

export function deserializeCandidates(
  serialized: SerializedAlertCandidate[],
): AlertCandidate[] {
  return serialized.map((c) => ({
    type: c.type,
    category: c.category,
    severity: c.severity,
    dedupKey: c.dedupKey,
    collapseKey: c.collapseKey,
    payload: c.payload,
    message: c.message,
    href: c.href,
    expiresAt: new Date(c.expiresAt),
  }));
}

// ---------- Notification (persist → dispatch) ----------
//
// `dispatchChannels` reads id, type, severity, message, href, pushDispatchedAt
// and digestDispatchedAt off each row. All Date fields are rendered ISO; we
// rebuild Dates on deserialize so the dispatch stage can keep using the
// existing Notification type without branching on string-vs-Date.

export interface SerializedNotification {
  id: string;
  type: string;
  severity: string;
  message: string;
  href: string;
  dedupKey: string | null;
  collapseKey: string | null;
  payload: string | null;
  isRead: boolean;
  pushDispatchedAt: string | null;
  digestDispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : null;
}

function dateOrNull(s: string | null | undefined): Date | null {
  return typeof s === "string" ? new Date(s) : null;
}

export function serializeNotifications(
  rows: Notification[],
): SerializedNotification[] {
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    severity: n.severity,
    message: n.message,
    href: n.href,
    dedupKey: n.dedupKey,
    collapseKey: n.collapseKey,
    payload: n.payload,
    isRead: n.isRead,
    pushDispatchedAt: isoOrNull(n.pushDispatchedAt),
    digestDispatchedAt: isoOrNull(n.digestDispatchedAt),
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    expiresAt: n.expiresAt.toISOString(),
  }));
}

export function deserializeNotifications(
  serialized: SerializedNotification[],
): Notification[] {
  return serialized.map((n) => ({
    id: n.id,
    type: n.type,
    severity: n.severity,
    message: n.message,
    href: n.href,
    dedupKey: n.dedupKey,
    collapseKey: n.collapseKey,
    payload: n.payload,
    isRead: n.isRead,
    pushDispatchedAt: dateOrNull(n.pushDispatchedAt),
    digestDispatchedAt: dateOrNull(n.digestDispatchedAt),
    createdAt: new Date(n.createdAt),
    updatedAt: new Date(n.updatedAt),
    expiresAt: new Date(n.expiresAt),
  })) as Notification[];
}
