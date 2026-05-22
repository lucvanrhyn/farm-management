/**
 * @vitest-environment node
 *
 * Issue #366 — logger UI surfacing of a byte-identical duplicate
 * camp_condition rejection.
 *
 * `createObservation` rejects a second-mount duplicate by throwing
 * `DuplicateObservationError`, which the API mapper renders as
 * `422 { error: "DUPLICATE_OBSERVATION", details: { existingId } }`.
 * The offline-sync queue records that response body verbatim in the
 * failed row's `lastError`. `FailedSyncDialog` runs `describeDuplicateFailure`
 * over each failed observation row so a duplicate gets a clear
 * "already logged" message. 422 already makes the row terminal, so the
 * helper keys on the typed `error` code (not the bare status) to
 * distinguish a duplicate from any other 422 (e.g. a missing-field
 * validation reject), which gets the generic poison-row notice instead.
 */
import { describe, it, expect } from "vitest";

import { describeDuplicateFailure } from "../FailedSyncDialog";

describe("describeDuplicateFailure (#366)", () => {
  const cases: Array<{
    name: string;
    lastError: string | null;
    lastStatusCode: number | null;
    expectDuplicate: boolean;
  }> = [
    {
      name: "flags a DUPLICATE_OBSERVATION 422 body as a duplicate",
      lastError: JSON.stringify({
        error: "DUPLICATE_OBSERVATION",
        details: { existingId: "obs-1" },
      }),
      lastStatusCode: 422,
      expectDuplicate: true,
    },
    {
      name: "does not flag a different 422 validation reject (CAMP_CONDITION_FIELD_REQUIRED)",
      lastError: JSON.stringify({ error: "CAMP_CONDITION_FIELD_REQUIRED" }),
      lastStatusCode: 422,
      expectDuplicate: false,
    },
    {
      name: "does not flag a DUPLICATE_OBSERVATION code carried on a non-422 status",
      lastError: JSON.stringify({ error: "DUPLICATE_OBSERVATION" }),
      lastStatusCode: 500,
      expectDuplicate: false,
    },
    {
      name: "does not flag a network failure (null body)",
      lastError: null,
      lastStatusCode: null,
      expectDuplicate: false,
    },
    {
      name: "does not flag a non-JSON 500 body",
      lastError: "Internal Server Error",
      lastStatusCode: 500,
      expectDuplicate: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = describeDuplicateFailure({
        lastError: c.lastError,
        lastStatusCode: c.lastStatusCode,
      });
      expect(result.isDuplicate).toBe(c.expectDuplicate);
    });
  }

  it("returns a clear already-logged message for a duplicate", () => {
    const result = describeDuplicateFailure({
      lastError: JSON.stringify({
        error: "DUPLICATE_OBSERVATION",
        details: { existingId: "obs-1" },
      }),
      lastStatusCode: 422,
    });
    expect(result.isDuplicate).toBe(true);
    expect(result.message.toLowerCase()).toContain("already logged");
  });
});
