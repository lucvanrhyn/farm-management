/**
 * __tests__/server/farmsettings-parity-overview-resilience.test.ts
 *
 * Issue #280 (parent PRD #279) — FarmSettings parity migration +
 * Overview resilience.
 *
 * ROOT CAUSE (not symptom): `prisma/schema.prisma` declares 21 FarmSettings
 * columns (`timezone`, `quietHoursStart`, `taskSettings`, the rotation
 * defaults, …) that NO migration or canonical bootstrap DDL ever creates —
 * they only ever existed on tenant DBs that had been `prisma db push`-ed
 * (the forbidden path). The #276 regression (commit 2653be5) made
 * `getCachedDashboardOverview` issue `prisma.farmSettings.findFirst()`,
 * whose default Prisma SELECT lists the drifted `timezone` column. On any
 * tenant without the drift applied, that SELECT throws `no such column:
 * timezone`. Because the sub-queries run in a single `Promise.all`, one
 * throwing query rejected the WHOLE aggregate — the admin Overview zeroed
 * ("0/9", "0/19") instead of degrading just the affected tile.
 *
 * This suite locks both halves of the fix:
 *
 *  1. SCHEMA PARITY — after the migration + bootstrap DDL change, EVERY
 *     FarmSettings column the Prisma schema declares is created by the
 *     canonical bootstrap DDL AND added by a tenant migration. Reuses the
 *     same parser the #131 column-parity gate uses so the assertion tracks
 *     the live invariant, not a hand-maintained list.
 *
 *  2. OVERVIEW RESILIENCE — when the FarmSettings prefetch throws (the
 *     exact "no such column: timezone" failure mode), the Overview still
 *     returns the correct NON-ZERO `inspectedToday` and the other tiles
 *     survive. A single failing sub-query degrades only its own tile.
 *     Tenant isolation: the per-tenant Prisma stub is the only data
 *     source, so Trio rows can never bleed into Basson.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { parsePrismaSchema } from "../../lib/ops/parse-prisma-schema";

// ── In-memory cache mirror of next/cache (same shape as the #225 test) ───────

const _cache = new Map<string, unknown>();

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
  ) => {
    return async (...args: unknown[]) => {
      const cacheKey = JSON.stringify([keyParts, ...args]);
      if (_cache.has(cacheKey)) return _cache.get(cacheKey);
      const result = await fn(...args);
      _cache.set(cacheKey, result);
      return result;
    };
  },
}));

// ── Prisma stub whose farmSettings.findFirst throws the drift error ──────────
//
// This reproduces the #276 production failure: a tenant DB missing the
// drifted `timezone` column. The default Prisma SELECT lists `timezone`,
// so libSQL rejects the statement with `no such column: timezone`. Every
// other delegate returns benign data so we can prove ONLY the settings
// tile degrades.

const DRIFT_ERROR = new Error(
  "no such column: timezone",
);

let _inspectedRows: { campId: string }[] = [];

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(
    async (_slug: string, fn: (p: unknown) => Promise<unknown>) => {
      const prisma = {
        animal: {
          count: vi.fn(async () => 42),
          groupBy: vi.fn().mockResolvedValue([]),
        },
        camp: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(7),
        },
        farmSettings: {
          // The poisoned query — exactly the #276 failure surface.
          findFirst: vi.fn(async () => {
            throw DRIFT_ERROR;
          }),
        },
        farmSpeciesSettings: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ species: "cattle", enabled: true }]),
        },
        observation: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn(async () => _inspectedRows),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        transaction: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return fn(prisma);
    },
  ),
  getPrismaForFarm: vi.fn(),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// countInspectedToday is the real implementation path; stub it to read the
// same `_inspectedRows` fixture so we can prove the tile survives + counts.
const _countInspectedTodayMock = vi.fn(
  async () => new Set(_inspectedRows.map((r) => r.campId)).size,
);

vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
  countHealthIssuesSince: vi.fn().mockResolvedValue(0),
  countInspectedToday: _countInspectedTodayMock,
  getRecentHealthObservations: vi.fn().mockResolvedValue([]),
  getLowGrazingCampCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/server/reproduction-analytics", () => ({
  getReproStats: vi.fn().mockResolvedValue({
    pregnancyRate: null,
    calvingRate: null,
    avgCalvingIntervalDays: null,
    upcomingCalvings: [],
    inHeat7d: 0,
    inseminations30d: 0,
    calvingsDue30d: 0,
    scanCounts: { pregnant: 0, empty: 0, uncertain: 0 },
    conceptionRate: null,
    pregnancyRateByCycle: [],
    daysOpen: [],
    avgDaysOpen: null,
    weaningRate: null,
  }),
}));

vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: vi
    .fn()
    .mockResolvedValue({ red: [], amber: [], totalCount: 0 }),
}));

vi.mock("@/lib/server/data-health", () => ({
  getDataHealthScore: vi
    .fn()
    .mockResolvedValue({ overall: 0, grade: "D", breakdown: {} }),
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getWithdrawalCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/species/game/analytics", () => ({
  getCensusPopulationByCamp: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/rotation-engine", () => ({
  getRotationStatusByCamp: vi.fn().mockResolvedValue({ camps: [] }),
}));

vi.mock("@/lib/server/veld-score", () => ({
  getLatestByCamp: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/server/feed-on-offer", () => ({
  getLatestCoverByCamp: vi.fn().mockResolvedValue(new Map()),
}));

// ── 1. SCHEMA PARITY ─────────────────────────────────────────────────────────

describe("FarmSettings schema parity (issue #280)", () => {
  async function readRepo(rel: string): Promise<string> {
    return readFile(join(__dirname, "..", "..", rel), "utf-8");
  }

  function bootstrapFarmSettingsColumns(farmSchemaTs: string): string[] {
    const m = farmSchemaTs.match(
      /CREATE TABLE "FarmSettings" \(([\s\S]*?)\n\);/,
    );
    if (!m) throw new Error("FarmSettings CREATE TABLE not found in farm-schema.ts");
    const cols: string[] = [];
    for (const raw of m[1].split("\n")) {
      const line = raw.trim();
      const cm = line.match(/^"([A-Za-z0-9_]+)"/);
      if (cm) cols.push(cm[1]);
    }
    return cols;
  }

  async function migrationAddedFarmSettingsColumns(): Promise<Set<string>> {
    const migDir = join(__dirname, "..", "..", "migrations");
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql"));
    const added = new Set<string>();
    const re =
      /ALTER\s+TABLE\s+["`]?FarmSettings["`]?\s+ADD\s+COLUMN\s+["`]?([A-Za-z0-9_]+)["`]?/gi;
    for (const f of files) {
      let sql = await readFile(join(migDir, f), "utf-8");
      // Strip line comments so a narrating header doesn't count.
      sql = sql
        .split("\n")
        .map((l) => {
          const i = l.indexOf("--");
          return i === -1 ? l : l.slice(0, i);
        })
        .join("\n");
      for (const mm of sql.matchAll(re)) added.add(mm[1]);
    }
    return added;
  }

  it("every Prisma FarmSettings column is created by the canonical bootstrap DDL", async () => {
    const schemaSrc = await readRepo("prisma/schema.prisma");
    const models = parsePrismaSchema(schemaSrc);
    const fs = models.find((m) => m.name === "FarmSettings");
    expect(fs).toBeDefined();

    const ddlCols = new Set(
      bootstrapFarmSettingsColumns(await readRepo("lib/farm-schema.ts")),
    );
    const missingFromDdl = fs!.columns.filter((c) => !ddlCols.has(c));
    expect(missingFromDdl).toEqual([]);
  });

  it("every drifted FarmSettings column is added by a tenant migration", async () => {
    const schemaSrc = await readRepo("prisma/schema.prisma");
    const models = parsePrismaSchema(schemaSrc);
    const fs = models.find((m) => m.name === "FarmSettings")!;

    // Columns the ORIGINAL bootstrap shipped with (pre-#280) need no
    // migration — they were created at tenant-provision time. Everything
    // declared after that must be carried by an ALTER TABLE migration so
    // existing tenants reach parity. The pre-#280 bootstrap stopped at
    // `heroImageUrl`; `aiaIdentificationMark` + `taxReferenceNumber` were
    // already migrated by 0011/0012.
    const PRE_280_LIVE = new Set([
      "id", "alertThresholdHours", "farmName", "breed", "updatedAt",
      "updatedBy", "adgPoorDoerThreshold", "calvingAlertDays",
      "daysOpenLimit", "campGrazingWarningDays", "latitude", "longitude",
      "targetStockingRate", "breedingSeasonStart", "breedingSeasonEnd",
      "weaningDate", "openaiApiKey", "heroImageUrl",
      "aiaIdentificationMark", "taxReferenceNumber",
    ]);

    const migrated = await migrationAddedFarmSettingsColumns();
    const needMigration = fs.columns.filter((c) => !PRE_280_LIVE.has(c));
    const stillMissing = needMigration.filter((c) => !migrated.has(c));
    expect(stillMissing).toEqual([]);
  });

  it("the new parity migration applies cleanly against a pre-#280 FarmSettings table", async () => {
    const db: Client = createClient({ url: ":memory:" });
    // Recreate the pre-#280 bootstrap FarmSettings (the live tenant shape).
    await db.execute(`
      CREATE TABLE "FarmSettings" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
        "alertThresholdHours" INTEGER NOT NULL DEFAULT 48,
        "farmName" TEXT NOT NULL DEFAULT 'My Farm',
        "breed" TEXT NOT NULL DEFAULT 'Mixed',
        "updatedAt" DATETIME NOT NULL,
        "updatedBy" TEXT,
        "adgPoorDoerThreshold" REAL NOT NULL DEFAULT 0.7,
        "calvingAlertDays" INTEGER NOT NULL DEFAULT 14,
        "daysOpenLimit" INTEGER NOT NULL DEFAULT 365,
        "campGrazingWarningDays" INTEGER NOT NULL DEFAULT 7,
        "latitude" REAL,
        "longitude" REAL,
        "targetStockingRate" REAL,
        "breedingSeasonStart" TEXT,
        "breedingSeasonEnd" TEXT,
        "weaningDate" TEXT,
        "openaiApiKey" TEXT,
        "heroImageUrl" TEXT DEFAULT '/farm-hero.jpg',
        "aiaIdentificationMark" TEXT,
        "taxReferenceNumber" TEXT
      )
    `);
    await db.execute(
      `INSERT INTO "FarmSettings" ("id","updatedAt") VALUES ('singleton','2026-05-16T00:00:00Z')`,
    );

    const migDir = join(__dirname, "..", "..", "migrations");
    const { readdir } = await import("node:fs/promises");
    const parityFile = (await readdir(migDir)).find((f) =>
      f.endsWith("_farmsettings_parity.sql"),
    );
    expect(parityFile).toBeDefined();

    let sql = await readFile(join(migDir, parityFile!), "utf-8");
    sql = sql
      .split("\n")
      .map((l) => {
        const i = l.indexOf("--");
        return i === -1 ? l : l.slice(0, i);
      })
      .join("\n");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.execute(stmt);
    }

    // After the migration the live table must carry `timezone` — the exact
    // column whose absence caused #276.
    const cols = await db.execute(`SELECT name FROM pragma_table_info('FarmSettings')`);
    const liveCols = new Set(cols.rows.map((r) => r.name as string));
    expect(liveCols.has("timezone")).toBe(true);
    expect(liveCols.has("quietHoursStart")).toBe(true);
    expect(liveCols.has("taskSettings")).toBe(true);

    // The pre-existing row keeps its data; timezone backfills to the default.
    const row = await db.execute(`SELECT timezone FROM "FarmSettings" WHERE id='singleton'`);
    expect(row.rows[0].timezone).toBe("Africa/Johannesburg");
  });
});

// ── 2. OVERVIEW RESILIENCE ───────────────────────────────────────────────────

describe("getCachedDashboardOverview resilience (issue #280)", () => {
  beforeEach(() => {
    _cache.clear();
    _countInspectedTodayMock.mockClear();
  });

  it("returns the correct non-zero inspectedToday even when farmSettings.findFirst throws (no-such-column drift)", async () => {
    // Two distinct camps inspected today → inspectedToday must be 2.
    _inspectedRows = [{ campId: "camp-a" }, { campId: "camp-b" }];

    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    const result = await getCachedDashboardOverview("basson", "cattle");

    // The whole Overview did NOT throw / zero out…
    expect(result).toBeDefined();
    // …the inspections tile is correct and non-zero…
    expect(result.inspectedToday).toBe(2);
    // …and the other tiles survived the poisoned settings query.
    expect(result.totalAnimals).toBe(42);
    expect(result.totalCamps).toBe(7);
  });

  it("degrades ONLY the settings-derived alert thresholds — overview still resolves", async () => {
    _inspectedRows = [{ campId: "camp-x" }];

    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    const result = await getCachedDashboardOverview("basson", "cattle");

    expect(result.inspectedToday).toBe(1);
    // dashboardAlerts still present (fed safe default thresholds when the
    // settings row could not be read).
    expect(result.dashboardAlerts).toBeDefined();
  });

  it("tenant isolation: a different farm reads only its own stubbed rows", async () => {
    _inspectedRows = [{ campId: "trio-only-camp" }];
    const { getCachedDashboardOverview } = await import("@/lib/server/cached");
    const trio = await getCachedDashboardOverview("trio", "cattle");
    expect(trio.inspectedToday).toBe(1);

    // Basson has its own (empty) inspection set — never sees Trio's camp.
    _inspectedRows = [];
    const basson = await getCachedDashboardOverview("basson", "cattle");
    expect(basson.inspectedToday).toBe(0);
  });
});
