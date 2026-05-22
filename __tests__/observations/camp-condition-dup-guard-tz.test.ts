/**
 * @vitest-environment node
 *
 * Issue #378 — camp-condition dup guard must use tenant FarmSettings.timezone.
 *
 * Root cause: `assertNotDuplicateCampCondition` hardcoded "Africa/Johannesburg"
 * when calling `getTenantDayRange`. Two `camp_condition` observations whose
 * `observedAt` instants fall on the SAME tenant-calendar-day under the tenant's
 * TZ but DIFFERENT days under SAST should be caught as duplicates — they
 * weren't because the guard bucketed by SAST, not the tenant's real TZ.
 *
 * Scenario (America/New_York, UTC-4 in EDT):
 *   - obs-A:  2026-05-12T05:00:00Z  = 01:00 EDT May 12
 *   - obs-B:  2026-05-13T03:30:00Z  = 23:30 EDT May 12  ← SAME NY calendar day as A
 *
 *   Under SAST (UTC+2):
 *     obs-A = 07:00 SAST May 12   → day-bucket: May 12
 *     obs-B = 05:30 SAST May 13   → day-bucket: May 13  ← different → SAST misses the dup
 *
 *   Under America/New_York (EDT):
 *     obs-A = 01:00 EDT May 12    → day-bucket: May 12
 *     obs-B = 23:30 EDT May 12    → day-bucket: May 12  ← same → correctly caught as dup
 *
 * The test proves `createObservation` reads `FarmSettings.timezone` from the
 * tenant DB and passes it to `getTenantDayRange` instead of the hardcoded
 * "Africa/Johannesburg".
 */
import { describe, expect, it } from "vitest";

import { createObservation } from "@/lib/domain/observations/create-observation";
import { DuplicateObservationError } from "@/lib/domain/observations/errors";

// Valid camp_condition details — includes all three required fields.
const VALID_DETAILS = JSON.stringify({
  grazing: "Good",
  water: "Full",
  fence: "Intact",
});

// SAST and NY tenant day boundaries:
//
//   2026-05-12T05:00:00Z  = 07:00 SAST May 12 = 01:00 EDT May 12
//   2026-05-13T03:30:00Z  = 05:30 SAST May 13 = 23:30 EDT May 12
//
// Under SAST these are different days → no dup caught (the pre-#378 bug).
// Under America/New_York both are EDT May 12 → dup MUST be thrown.
const OBS_A_UTC = "2026-05-12T05:00:00.000Z"; // first submission
const OBS_B_UTC = "2026-05-13T03:30:00.000Z"; // second submission (23:30 EDT — same NY day)

type FarmSettingsRow = { timezone: string | null } | null;

/**
 * Build a fake PrismaClient exposing only what `assertNotDuplicateCampCondition`
 * + `createObservation` actually touch:
 *   - `farmSettings.findFirst` (new: used by the tz-aware guard)
 *   - `observation.findFirst` (dup-guard lookup)
 *   - `observation.create` / `observation.upsert` (write paths)
 *   - `camp.findFirst` via `crossSpecies` wrapper (existence check)
 *   - `animal.findUnique` (species waterfall)
 *
 * The `observation.findFirst` mock simulates "a matching row already exists
 * for obs-A when obs-B arrives". Whether it returns a row depends on whether
 * the guard's `observedAt` window actually covers obs-A — which depends on
 * which TZ the guard uses.
 */
function makeFakePrisma(farmSettingsRow: FarmSettingsRow) {
  // The guard queries:
  //   observedAt: { gte: dayStart, lt: dayEnd }
  // We need to record those timestamps so we can assert which TZ was used.
  let capturedGte: Date | undefined;
  let capturedLt: Date | undefined;

  // obs-A was already written at 2026-05-12T05:00:00Z. obs-B arrives and the
  // guard checks if there's an existing matching row in the same day window.
  // `findFirst` returns "found" only if obs-A falls within [gte, lt).
  const findFirst_observation = async (args: {
    where?: {
      observedAt?: { gte?: Date; lt?: Date };
    };
  }): Promise<{ id: string } | null> => {
    const gte = args.where?.observedAt?.gte;
    const lt = args.where?.observedAt?.lt;
    capturedGte = gte;
    capturedLt = lt;

    if (!gte || !lt) return null;

    // obs-A is at 2026-05-12T05:00:00Z (= 5 * 3600 * 1000 ms since epoch).
    const obsAMs = new Date(OBS_A_UTC).getTime();
    // Returns the existing row only if obs-A falls in the guard's window.
    if (obsAMs >= gte.getTime() && obsAMs < lt.getTime()) {
      return { id: "obs-A-existing" };
    }
    return null;
  };

  const fake = {
    _captured: () => ({ gte: capturedGte, lt: capturedLt }),

    farmSettings: {
      findFirst: async (): Promise<FarmSettingsRow> => farmSettingsRow,
    },

    observation: {
      findFirst: findFirst_observation,
      create: async (args: { data: { type: string; campId: string } }) => ({
        id: "obs-new",
        ...args.data,
      }),
      upsert: async (args: { create: { type: string; campId: string } }) => ({
        id: "obs-upserted",
        ...args.create,
      }),
    },

    camp: {
      findFirst: async () => ({ campId: "camp-X", species: null }),
    },

    animal: {
      findUnique: async () => null,
    },
  };

  return fake;
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function asPrisma(fake: FakePrisma): Parameters<typeof createObservation>[0] {
  return fake as unknown as Parameters<typeof createObservation>[0];
}

describe("assertNotDuplicateCampCondition — tenant timezone (#378)", () => {
  it("throws DuplicateObservationError when both observations fall on the SAME tenant-calendar-day under the tenant's TZ (NY)", async () => {
    // Tenant has America/New_York tz.  obs-A (01:00 EDT May 12) and
    // obs-B (23:30 EDT May 12) share the same NY calendar day → dup.
    const fake = makeFakePrisma({ timezone: "America/New_York" });

    await expect(
      createObservation(asPrisma(fake), {
        type: "camp_condition",
        camp_id: "camp-X",
        details: VALID_DETAILS,
        // obs-B arrives — obs-A is already in the DB at OBS_A_UTC
        created_at: OBS_B_UTC,
        loggedBy: "farmer@example.com",
        // Different clientLocalId → not same form-mount retry
        clientLocalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).rejects.toThrow(DuplicateObservationError);
  });

  it("does NOT throw when the same two instants span DIFFERENT tenant-calendar-days under the tenant's TZ (SAST)", async () => {
    // Tenant has Africa/Johannesburg tz.  obs-A (07:00 SAST May 12) and
    // obs-B (05:30 SAST May 13) are on different SAST days → not a dup.
    const fake = makeFakePrisma({ timezone: "Africa/Johannesburg" });

    // obs-B's guard window is the SAST calendar day of 2026-05-13 (UTC+2):
    //   [2026-05-12T22:00Z, 2026-05-13T22:00Z)
    // obs-A is at 2026-05-12T05:00Z — BEFORE that window → findFirst returns null.
    await expect(
      createObservation(asPrisma(fake), {
        type: "camp_condition",
        camp_id: "camp-X",
        details: VALID_DETAILS,
        created_at: OBS_B_UTC,
        loggedBy: "farmer@example.com",
        clientLocalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("falls back to Africa/Johannesburg when FarmSettings row is null (drift resilience)", async () => {
    // When farmSettings.findFirst() returns null, the guard must not crash —
    // it should fall back to SAST and proceed.  The two instants in the SAST
    // scenario above are different days under SAST → resolves without throwing.
    const fake = makeFakePrisma(null);

    await expect(
      createObservation(asPrisma(fake), {
        type: "camp_condition",
        camp_id: "camp-X",
        details: VALID_DETAILS,
        created_at: OBS_B_UTC,
        loggedBy: "farmer@example.com",
        clientLocalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("falls back to Africa/Johannesburg when FarmSettings.timezone is null (not yet configured)", async () => {
    const fake = makeFakePrisma({ timezone: null });

    await expect(
      createObservation(asPrisma(fake), {
        type: "camp_condition",
        camp_id: "camp-X",
        details: VALID_DETAILS,
        created_at: OBS_B_UTC,
        loggedBy: "farmer@example.com",
        clientLocalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("falls back to Africa/Johannesburg and does NOT propagate when farmSettings.findFirst throws (schema drift)", async () => {
    // Simulates a tenant DB where the `timezone` column does not exist yet
    // (legacy schema drift). The guard must swallow the error and continue.
    const driftFake = {
      farmSettings: {
        findFirst: async () => {
          throw new Error("no such column: timezone");
        },
      },
      observation: {
        findFirst: async () => null,
        create: async (args: { data: { type: string; campId: string } }) => ({
          id: "obs-new",
          ...args.data,
        }),
        upsert: async (args: { create: { type: string; campId: string } }) => ({
          id: "obs-upserted",
          ...args.create,
        }),
      },
      camp: {
        findFirst: async () => ({ campId: "camp-X", species: null }),
      },
      animal: {
        findUnique: async () => null,
      },
    };

    await expect(
      createObservation(
        driftFake as unknown as Parameters<typeof createObservation>[0],
        {
          type: "camp_condition",
          camp_id: "camp-X",
          details: VALID_DETAILS,
          created_at: OBS_B_UTC,
          loggedBy: "farmer@example.com",
          clientLocalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        },
      ),
    ).resolves.toMatchObject({ success: true });
  });
});
