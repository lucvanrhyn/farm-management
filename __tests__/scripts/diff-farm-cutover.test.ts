// @vitest-environment node
/**
 * Tests for scripts/diff-farm-cutover.ts
 *
 * TDD RED phase: all tests written before the production module exists.
 * The @libsql/client module is mocked at the boundary so no real Turso DB
 * is needed. Tests exercise the exported helpers directly (safeRead,
 * enumerateTables, diffTable, formatMarkdown, runDiff) plus the process
 * exit-code semantics via a wrapper that captures the intended exit code.
 *
 * Test cases:
 *  1. Identical DBs → exit 0, zero divergent tables
 *  2. Target-ahead (post-cutover writes) → exit 0, divergent table reported
 *  3. Source-ahead (lost write) → exit 1, source-only IDs listed
 *  4. Schema drift → exit 2, diff runs on intersection
 *  5. safeRead rejects non-SELECT SQL → throws READ_ONLY_VIOLATION
 *  6. JSON output written to --out path
 *  7. Markdown output includes verdict and table header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { Client } from "@libsql/client";

// ---------------------------------------------------------------------------
// Mock @libsql/client BEFORE importing the module under test.
// We expose a factory so each test can configure per-table responses.
// ---------------------------------------------------------------------------

// The mock client shape mirrors what the script uses:
//   client.execute({ sql, args? })  → Promise<{ rows: Row[] }>
// Where Row = Record<string, unknown>

type MockRow = Record<string, unknown>;
type MockQueryHandler = (sql: string) => MockRow[];

// Per-connection query handlers — keyed by connection index (0 = source, 1 = target).
const _handlers: MockQueryHandler[] = [];

function makeClient(handlerIndex: number) {
  return {
    execute: vi.fn(({ sql }: { sql: string; args?: unknown[] }) => {
      const handler = _handlers[handlerIndex];
      if (!handler) throw new Error(`No handler registered for connection ${handlerIndex}`);
      const rows = handler(sql.trim());
      return Promise.resolve({ rows });
    }),
  };
}

let _connectionCount = 0;
const _clients: ReturnType<typeof makeClient>[] = [];

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => {
    const idx = _connectionCount++;
    const client = makeClient(idx);
    _clients[idx] = client;
    return client;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers to configure mock responses
// ---------------------------------------------------------------------------

/** Typical table-enum response: list of { name: string } rows. */
function tableListRows(names: string[]): MockRow[] {
  return names.map((name) => ({ name }));
}

/** COUNT(*) response */
function countRow(n: number): MockRow[] {
  return [{ "COUNT(*)": n }];
}

/** MAX(updatedAt) response */
function maxUpdatedAtRow(val: string | null): MockRow[] {
  return [{ "MAX(updatedAt)": val }];
}

/** MAX(createdAt) response */
function maxCreatedAtRow(val: string | null): MockRow[] {
  return [{ "MAX(createdAt)": val }];
}

/** PRAGMA table_info response — returns id column (cid 0, name "id") + optional updatedAt */
function pragmaRows(
  cols: string[] = ["id", "updatedAt", "createdAt"],
): MockRow[] {
  return cols.map((name, cid) => ({ cid, name }));
}

/** ID list for a table */
function idRows(ids: string[]): MockRow[] {
  return ids.map((id) => ({ id }));
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER mock setup.
// (Dynamic import used so vi.mock runs first in all environments.)
// ---------------------------------------------------------------------------

// Dynamic import gives us a real module reference after mock wiring.
// Typed via the production module so TypeScript validates the contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: typeof import("../../scripts/diff-farm-cutover") & { [key: string]: any };

// Temp dir for JSON output — prevents test runs from writing to docs/ops/
let tmpDir: string;

beforeEach(async () => {
  // Reset connection counter + clients between tests
  _connectionCount = 0;
  _clients.length = 0;
  _handlers.length = 0;

  // Create a fresh temp dir for JSON output artifacts
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-cutover-test-"));

  // (Re)import the module under test fresh each test so mock state is clean.
  // vitest resets module registry when we call vi.resetModules() in afterEach.
  mod = await import("../../scripts/diff-farm-cutover.js");
});

afterEach(() => {
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 1: Identical DBs → exit 0, zero divergent tables
// ---------------------------------------------------------------------------

describe("runDiff: identical DBs", () => {
  it("returns exitCode 0 and no divergent tables when both sides match", async () => {
    const TABLES = ["users"];
    const SRC_IDS = ["user-1", "user-2", "user-3"];
    const TS = "2026-04-20T10:00:00.000Z";

    function handler(sql: string): MockRow[] {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(3);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(SRC_IDS);
      return [];
    }

    _handlers[0] = handler; // source
    _handlers[1] = handler; // target (identical)

    const result = await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "test-farm",
      outPath: path.join(tmpDir, "out.json"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.divergentTables).toEqual([]);
    expect(result.schemaMismatch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Target-ahead (post-cutover writes) → exit 0
// Source has 41 Notification rows; target has 45 (4 post-cutover)
// ---------------------------------------------------------------------------

describe("runDiff: target-ahead (post-cutover)", () => {
  it("returns exitCode 0 when target has extra rows (no source-only rows)", async () => {
    const TABLES = ["Notification"];
    const SRC_IDS = Array.from({ length: 41 }, (_, i) => `notif-src-${i}`);
    const DST_IDS = [
      ...SRC_IDS,
      "notif-post-1",
      "notif-post-2",
      "notif-post-3",
      "notif-post-4",
    ];
    const SRC_TS = "2026-04-24T03:00:33.109Z";
    const DST_TS = "2026-04-25T03:00:32.467Z";

    _handlers[0] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(41);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(SRC_TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(SRC_TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(SRC_IDS);
      return [];
    };
    _handlers[1] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(45);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(DST_TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(DST_TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(DST_IDS);
      return [];
    };

    const result = await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "trio-b-boerdery",
      outPath: path.join(tmpDir, "out.json"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.divergentTables).toHaveLength(1);
    expect(result.divergentTables[0].name).toBe("Notification");
    expect(result.divergentTables[0].divergentRows.onlyOnSrc).toHaveLength(0);
    expect(result.divergentTables[0].divergentRows.onlyOnDst).toHaveLength(4);
    expect(result.schemaMismatch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Source-ahead (lost write) → exit 1
// Source has 5 Animal rows; target has 4 (1 was lost)
// ---------------------------------------------------------------------------

describe("runDiff: source-ahead (lost write)", () => {
  it("returns exitCode 1 when source has rows not on target", async () => {
    const TABLES = ["Animal"];
    const SRC_IDS = ["animal-1", "animal-2", "animal-3", "animal-4", "animal-LOST"];
    const DST_IDS = ["animal-1", "animal-2", "animal-3", "animal-4"];
    const TS = "2026-04-20T10:00:00.000Z";

    _handlers[0] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(5);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(SRC_IDS);
      return [];
    };
    _handlers[1] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(4);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(DST_IDS);
      return [];
    };

    const result = await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "test-farm",
      outPath: path.join(tmpDir, "out.json"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.divergentTables).toHaveLength(1);
    expect(result.divergentTables[0].name).toBe("Animal");
    expect(result.divergentTables[0].divergentRows.onlyOnSrc).toContain("animal-LOST");
    expect(result.divergentTables[0].divergentRows.onlyOnDst).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Schema drift → exit 2, diff runs on intersection [A, B]
// Source tables: [A, B, C]; Target tables: [A, B, D]
// ---------------------------------------------------------------------------

describe("runDiff: schema drift", () => {
  it("returns exitCode 2, reports mismatch, and runs counts on intersection only", async () => {
    const SRC_TABLES = ["A", "B", "C"];
    const DST_TABLES = ["A", "B", "D"];
    const TS = "2026-04-20T10:00:00.000Z";

    function identicalHandler(sql: string): MockRow[] {
      if (sql.toLowerCase().includes("sqlite_master")) {
        // Will be called per-connection — handler index is set below
        return []; // placeholder, overridden per side
      }
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows(["id"]);
      if (sql.toLowerCase().startsWith("select count")) return countRow(2);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(["row-1", "row-2"]);
      return [];
    }

    _handlers[0] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(SRC_TABLES);
      return identicalHandler(sql);
    };
    _handlers[1] = (sql: string): MockRow[] => {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(DST_TABLES);
      return identicalHandler(sql);
    };

    const result = await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "test-farm",
      outPath: path.join(tmpDir, "out.json"),
    });

    expect(result.exitCode).toBe(2);
    expect(result.schemaMismatch).not.toBeNull();
    expect(result.schemaMismatch!.onlyOnSrc).toContain("C");
    expect(result.schemaMismatch!.onlyOnDst).toContain("D");
    // The count diff must have run on the intersection [A, B] only
    const diffedNames = result.divergentTables.map((t) => t.name);
    // C and D should NOT appear — they were not in the intersection
    expect(diffedNames).not.toContain("C");
    expect(diffedNames).not.toContain("D");
    // A and B may or may not appear (they're identical here, so divergentTables
    // might be empty — what matters is C and D are absent)
  });
});

// ---------------------------------------------------------------------------
// Test 5: safeRead rejects non-SELECT SQL with READ_ONLY_VIOLATION
// ---------------------------------------------------------------------------

describe("safeRead: read-only enforcement", () => {
  it("throws with code READ_ONLY_VIOLATION for INSERT statements", async () => {
    const fakeClient = {
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    } as unknown as Pick<Client, "execute">;

    await expect(
      mod.safeRead(fakeClient, "INSERT INTO foo VALUES (1)"),
    ).rejects.toThrow("READ_ONLY_VIOLATION");
  });

  it("throws with code READ_ONLY_VIOLATION for UPDATE statements", async () => {
    const fakeClient = {
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    } as unknown as Pick<Client, "execute">;

    await expect(
      mod.safeRead(fakeClient, "UPDATE foo SET bar = 1"),
    ).rejects.toThrow("READ_ONLY_VIOLATION");
  });

  it("allows SELECT statements through", async () => {
    const fakeClient = {
      execute: vi.fn(() => Promise.resolve({ rows: [{ id: "x" }] })),
    } as unknown as Pick<Client, "execute">;

    const rows = await mod.safeRead(fakeClient, "SELECT id FROM foo");
    expect(rows).toEqual([{ id: "x" }]);
    expect((fakeClient.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6: JSON output written to --out path
// ---------------------------------------------------------------------------

describe("runDiff: JSON output file", () => {
  it("writes valid JSON to the specified --out path", async () => {
    // Uses the shared tmpDir from beforeEach (cleaned up in afterEach)
    const outPath = path.join(tmpDir, "diff-output.json");

    const TABLES = ["Animal"];
    const IDS = ["a-1", "a-2"];
    const TS = "2026-04-20T10:00:00.000Z";

    function handler(sql: string): MockRow[] {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(2);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(IDS);
      return [];
    }

    _handlers[0] = handler;
    _handlers[1] = handler;

    await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "test-farm",
      outPath,
    });

    expect(fs.existsSync(outPath)).toBe(true);
    const raw = fs.readFileSync(outPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Required top-level keys
    expect(parsed).toHaveProperty("tenant", "test-farm");
    expect(parsed).toHaveProperty("source");
    expect(parsed).toHaveProperty("target");
    expect(parsed).toHaveProperty("generatedAt");
    expect(parsed).toHaveProperty("tables");
    expect(Array.isArray(parsed.tables)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Markdown output includes verdict and per-table summary header
// ---------------------------------------------------------------------------

describe("runDiff: Markdown output", () => {
  it("returns markdown string with verdict line and table header", async () => {
    const TABLES = ["Animal"];
    const IDS = ["a-1"];
    const TS = "2026-04-20T10:00:00.000Z";

    function handler(sql: string): MockRow[] {
      if (sql.toLowerCase().includes("sqlite_master")) return tableListRows(TABLES);
      if (sql.toLowerCase().includes("pragma_table_info")) return pragmaRows();
      if (sql.toLowerCase().startsWith("select count")) return countRow(1);
      if (sql.toLowerCase().includes("max(updatedat)")) return maxUpdatedAtRow(TS);
      if (sql.toLowerCase().includes("max(createdat)")) return maxCreatedAtRow(TS);
      if (sql.toLowerCase().startsWith("select id")) return idRows(IDS);
      return [];
    }

    _handlers[0] = handler;
    _handlers[1] = handler;

    const result = await mod.runDiff({
      sourceUrl: "libsql://src.turso.io",
      sourceToken: "token-src",
      targetUrl: "libsql://dst.turso.io",
      targetToken: "token-dst",
      tenant: "my-farm",
      outPath: path.join(tmpDir, "out.json"),
    });

    expect(typeof result.markdown).toBe("string");
    // Should include the tenant name
    expect(result.markdown).toContain("my-farm");
    // Should include a verdict line about lost writes
    expect(result.markdown.toLowerCase()).toMatch(/no lost writes|lost writes/);
    // Should include a table-level summary section
    expect(result.markdown).toMatch(/table|Table/);
  });
});
