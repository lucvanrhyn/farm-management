// lib/server/alerts/dedup.ts — de-dup + collapse persistence.
//
// Algorithm (research brief §B):
//   1. Group candidates by (type, collapseKey). When a group's size reaches
//      COLLAPSE_THRESHOLD[type], fold it into a single candidate with merged
//      payload (animalIds union, count = size) before writing to DB.
//   2. For each (possibly collapsed) candidate, upsert on (type, dedupKey):
//      - if existing row is unread, merge payload + bump updatedAt + re-render
//        message (so counts stay accurate across the day's runs);
//      - if existing row is read, create a fresh row;
//      - else create new.
//
// Atomicity: each upsert is its own transaction. If two cron runs race (which
// Inngest concurrency.limit=10 prevents per-tenant, but test in parallel), the
// Notification @@unique(type, dedupKey) constraint keeps us from double-
// writing the same key.

import type { PrismaClient, Notification } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { getCollapseThreshold } from "./types";

/**
 * Prisma raises P2002 on a unique-constraint violation. We use this narrow
 * guard (rather than Prisma.PrismaClientKnownRequestError) so the module
 * doesn't import runtime Prisma types — keeps the server alerts package
 * cheap to test in jsdom/node fixtures.
 */
function isP2002(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

interface PayloadWithIds {
  animalIds?: string[];
  count?: number;
  animalId?: string;
  campId?: string;
  [key: string]: unknown;
}

function parsePayload(raw: string | null): PayloadWithIds {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PayloadWithIds;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function collectAnimalIds(p: PayloadWithIds): string[] {
  const ids = new Set<string>();
  if (Array.isArray(p.animalIds)) {
    for (const id of p.animalIds) if (typeof id === "string") ids.add(id);
  }
  if (typeof p.animalId === "string") ids.add(p.animalId);
  return Array.from(ids);
}

function mergePayloads(
  existing: PayloadWithIds,
  incoming: PayloadWithIds,
): PayloadWithIds {
  const merged: PayloadWithIds = { ...existing, ...incoming };
  const unionIds = new Set([
    ...collectAnimalIds(existing),
    ...collectAnimalIds(incoming),
  ]);
  if (unionIds.size > 0) merged.animalIds = Array.from(unionIds);
  if (typeof existing.count === "number" && typeof incoming.count === "number") {
    merged.count = Math.max(existing.count, incoming.count);
  } else if (unionIds.size > 0) {
    merged.count = unionIds.size;
  }
  return merged;
}

/**
 * Collapse groups whose size meets or exceeds the per-type threshold into a
 * single aggregate candidate. Groups below threshold pass through unchanged.
 */
export function collapseCandidates(candidates: AlertCandidate[]): AlertCandidate[] {
  if (candidates.length === 0) return [];
  const byGroup = new Map<string, AlertCandidate[]>();
  const out: AlertCandidate[] = [];

  for (const c of candidates) {
    if (c.collapseKey == null) {
      out.push(c);
      continue;
    }
    const key = `${c.type}:${c.collapseKey}`;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(c);
    else byGroup.set(key, [c]);
  }

  for (const [key, group] of byGroup) {
    const threshold = getCollapseThreshold(group[0].type);
    if (group.length < threshold) {
      out.push(...group);
      continue;
    }
    // Fold into one.
    const first = group[0];
    const animalIds = Array.from(
      new Set(
        group
          .map((g) => (g.payload as PayloadWithIds).animalId)
          .filter((v): v is string => typeof v === "string"),
      ),
    );
    const campIds = Array.from(
      new Set(
        group
          .map((g) => (g.payload as PayloadWithIds).campId)
          .filter((v): v is string => typeof v === "string"),
      ),
    );
    const aggregated: AlertCandidate = {
      type: first.type,
      category: first.category,
      severity: first.severity,
      dedupKey: `${first.type}:${first.collapseKey}:collapsed:${key.replace(/[^a-zA-Z0-9:_-]/g, "")}`,
      collapseKey: first.collapseKey,
      payload: {
        collapsed: true,
        count: group.length,
        animalIds,
        campIds,
        collapseKey: first.collapseKey,
      },
      message: `${group.length} ${first.type.toLowerCase().replace(/_/g, " ")} alerts (grouped)`,
      href: first.href,
      expiresAt: first.expiresAt,
    };
    out.push(aggregated);
  }

  return out;
}

/**
 * Persist a set of candidates with merge-on-conflict semantics. Returns the
 * list of Notification rows (new + updated) so the dispatcher can decide what
 * to push/email.
 *
 * Race-safety: two concurrent runs with the same (type, dedupKey) both see
 * "no existing" in findFirst and both call create. The second create fails
 * with Prisma P2002 (unique constraint violation). We catch that, re-read
 * the winner, and fall into the merge branch — so the loser's payload still
 * gets merged into the winning row instead of blowing up the whole tenant
 * step. `dedupKey === null` candidates bypass this path (no de-dup possible).
 */
export async function persistNotifications(
  prisma: PrismaClient,
  candidates: AlertCandidate[],
): Promise<Notification[]> {
  if (candidates.length === 0) return [];
  const collapsed = collapseCandidates(candidates);
  const persisted: Notification[] = [];

  for (const c of collapsed) {
    // No dedupKey → always create fresh. The composite unique (type, dedupKey)
    // is nullable and SQLite treats every NULL as distinct, so there's no
    // collision possible and no merge to do.
    if (c.dedupKey == null) {
      const created = await prisma.notification.create({
        data: {
          type: c.type,
          severity: c.severity,
          message: c.message,
          href: c.href,
          dedupKey: null,
          collapseKey: c.collapseKey,
          payload: JSON.stringify(c.payload),
          expiresAt: c.expiresAt,
        },
      });
      persisted.push(created);
      continue;
    }

    const existing = await prisma.notification.findFirst({
      where: { type: c.type, dedupKey: c.dedupKey },
    });

    if (existing && !existing.isRead) {
      const mergedPayload = mergePayloads(parsePayload(existing.payload), c.payload);
      const updated = await prisma.notification.update({
        where: { id: existing.id },
        data: {
          severity: c.severity,
          message: c.message,
          href: c.href,
          payload: JSON.stringify(mergedPayload),
          collapseKey: c.collapseKey,
          expiresAt: c.expiresAt,
        },
      });
      persisted.push(updated);
      continue;
    }

    // If a READ row exists we create a fresh row with a distinct dedupKey
    // (suffix with the current run timestamp) so we don't collide with the
    // unique constraint but still let the next cycle re-dedupe.
    const dedupKey = existing && existing.isRead ? `${c.dedupKey}:${Date.now()}` : c.dedupKey;

    try {
      const created = await prisma.notification.create({
        data: {
          type: c.type,
          severity: c.severity,
          message: c.message,
          href: c.href,
          dedupKey,
          collapseKey: c.collapseKey,
          payload: JSON.stringify(c.payload),
          expiresAt: c.expiresAt,
        },
      });
      persisted.push(created);
    } catch (err: unknown) {
      // A concurrent run beat us to the insert. Re-read the winner and merge
      // our payload into it so no candidate data is lost.
      if (!isP2002(err)) throw err;
      const winner = await prisma.notification.findFirst({
        where: { type: c.type, dedupKey, isRead: false },
      });
      if (!winner) {
        // The winner was marked read between our create and this re-read —
        // re-throw so the step fails loudly instead of silently dropping the
        // candidate (per memory/silent-failure-pattern.md).
        throw err;
      }
      const mergedPayload = mergePayloads(parsePayload(winner.payload), c.payload);
      const updated = await prisma.notification.update({
        where: { id: winner.id },
        data: {
          severity: c.severity,
          message: c.message,
          href: c.href,
          payload: JSON.stringify(mergedPayload),
          collapseKey: c.collapseKey,
          expiresAt: c.expiresAt,
        },
      });
      persisted.push(updated);
    }
  }

  return persisted;
}
