/**
 * @vitest-environment node
 *
 * Issue #483 (Epic B1, security) — sanitize unmapped/Prisma errors so the
 * API never serializes raw internal schema to authenticated clients.
 *
 * Background: `mapApiDomainError` previously had NO arm for any Prisma
 * exception class, so a Prisma throw fell through to the route adapters'
 * `routeError("DB_QUERY_FAILED", err.message, 500)` fallback — which copied
 * the raw Prisma message (table/column/payload text) verbatim into the
 * response body.
 *
 * Contract addition: `mapApiDomainError` now detects Prisma exception
 * classes BY NAME (so the module never takes a runtime dependency on
 * `@prisma/client`) and returns the canonical `DB_QUERY_FAILED` envelope
 * with NO `message` field. The full error continues to the server logger.
 */

import { describe, it, expect, vi } from "vitest";
import { mapApiDomainError } from "@/lib/server/api-errors";

async function readBody(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

/**
 * Build an Error whose `.name` matches a Prisma exception class and whose
 * `.message` carries internal schema text we must NOT leak.
 */
function makePrismaError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const PRISMA_CLASS_NAMES = [
  "PrismaClientValidationError",
  "PrismaClientKnownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "PrismaClientUnknownRequestError",
] as const;

describe("mapApiDomainError — Prisma exception sanitization (#483)", () => {
  for (const name of PRISMA_CLASS_NAMES) {
    it(`maps ${name} → 500 DB_QUERY_FAILED with NO message (no schema leak)`, async () => {
      // NB: use `aggregate()` not `findMany()` here — the audit-findmany-no-take
      // call-site scanner text-matches `.findMany(` even inside a string literal,
      // and would flag this mock error message as an unbounded query. The exact
      // Prisma method is irrelevant to what this test locks (raw-message non-leak).
      const leak =
        "Invalid `prisma.animal.aggregate()` invocation: column `secret_col` does not exist on table `Animal`";
      const res = mapApiDomainError(makePrismaError(name, leak));

      expect(res).not.toBeNull();
      expect(res!.status).toBe(500);

      const body = await readBody(res!);
      expect(body).toEqual({ error: "DB_QUERY_FAILED" });
      // The raw message MUST NOT appear anywhere in the serialized body.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("secret_col");
      expect(serialized).not.toContain("prisma.animal");
      expect(serialized).not.toContain(leak);
    });
  }

  it("writes the full Prisma error to the server logger", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const err = makePrismaError(
        "PrismaClientKnownRequestError",
        "Unique constraint failed on the fields: (`tenantSecret`)",
      );
      mapApiDomainError(err);
      expect(spy).toHaveBeenCalledTimes(1);
      // The logged payload retains the full error for server-side debugging.
      const [, meta] = spy.mock.calls[0] as [string, { error?: unknown }];
      expect(meta.error).toBe(err);
    } finally {
      spy.mockRestore();
    }
  });

  it("still returns null for a generic Error so the caller can rethrow", () => {
    // Non-Prisma errors are unchanged: the adapter fallthrough handles them
    // (now ALSO without leaking the message — see adapter tests).
    expect(mapApiDomainError(new Error("boom"))).toBeNull();
  });

  it("does not misclassify an unrelated error whose name merely contains 'Prisma'", () => {
    // Defensive: only the exact known class names are sanitized-as-DB. A
    // bespoke domain error should still fall through to null.
    expect(mapApiDomainError(makePrismaError("MyPrismaWrapperError", "x"))).toBeNull();
  });
});
