/**
 * @vitest-environment node
 *
 * S17 (OB-005/api-F2) — `app/api/animals/import/route.ts` interpolated the
 * raw upsert error into the SSE error string:
 *
 *   errors.push(`Row ${rowNum} (${animalId}): DB error — ${String(err)}`);
 *
 * A Prisma/driver failure carries internal schema text (table/column names,
 * invocation payload) which streamed straight to the authenticated client.
 * Contract: per-row DB failures surface a TYPED, user-safe message; the full
 * error goes to the server log only — same convention as
 * `mapApiDomainError`'s DB_QUERY_FAILED sanitization (#483).
 *
 * Harness mirrors `animals-import-file-type.test.ts` (real adminWrite
 * adapter, mocked farm-context/auth/rate-limit/revalidate) and additionally
 * mocks `@/lib/xlsx-shim` so no real workbook is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (declared before route import — vitest hoists `vi.mock`)
// ---------------------------------------------------------------------------

const getFarmContextMock = vi.fn();
vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: (...args: unknown[]) => getFarmContextMock(...args),
}));

const verifyFreshAdminRoleMock = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyFreshAdminRole: (...args: unknown[]) =>
      verifyFreshAdminRoleMock(...args),
  };
});

const checkRateLimitMock = vi.fn().mockReturnValue({ allowed: true });
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateAnimalWrite: vi.fn(),
}));

const { sheetRows } = vi.hoisted(() => ({
  sheetRows: [] as Array<Record<string, string>>,
}));
vi.mock("@/lib/xlsx-shim", () => ({
  readWorkbook: vi.fn(async () => ({ sheetNames: ["Animals"] })),
  readSheetAsObjects: vi.fn(() => sheetRows),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRISMA_LEAK =
  "Invalid `prisma.animal.upsert()` invocation: column `secret_col` does not exist on table `Animal`";

function makePrismaError(message: string): Error {
  const err = new Error(message);
  err.name = "PrismaClientKnownRequestError";
  return err;
}

function makeXlsxReq(): NextRequest {
  const fd = new FormData();
  fd.append(
    "file",
    new File(["irrelevant — xlsx-shim is mocked"], "herd.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return new NextRequest("http://localhost/api/animals/import", {
    method: "POST",
    body: fd,
  });
}

type UpsertArgs = { where: { animalId: string } };

function makePrisma(failingAnimalIds: ReadonlySet<string>) {
  return {
    farmSettings: { findFirst: vi.fn(async () => null) },
    camp: { findMany: vi.fn(async () => []) },
    animal: {
      upsert: vi.fn(async ({ where }: UpsertArgs) => {
        if (failingAnimalIds.has(where.animalId)) {
          throw makePrismaError(PRISMA_LEAK);
        }
        return { animalId: where.animalId };
      }),
    },
  };
}

function primeAdmin(prisma: unknown) {
  getFarmContextMock.mockResolvedValue({
    prisma: prisma as never,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "luc@example.com" } },
  });
}

/** Parse the terminal `done` SSE frame out of the streamed body. */
function parseDoneFrame(sseText: string): {
  done: boolean;
  imported: number;
  skipped: number;
  errors: string[];
} {
  const frames = sseText
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice("data: ".length)));
  const done = frames.find((f) => f.done === true);
  if (!done) throw new Error(`no done frame in SSE body: ${sseText}`);
  return done;
}

beforeEach(() => {
  getFarmContextMock.mockReset();
  verifyFreshAdminRoleMock.mockReset();
  verifyFreshAdminRoleMock.mockResolvedValue(true);
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockReturnValue({ allowed: true });
  sheetRows.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/animals/import — DB-error sanitization (S17 / OB-005 / api-F2)", () => {
  it("streams a typed per-row message — never the raw Prisma text", async () => {
    const prisma = makePrisma(new Set(["A001"]));
    primeAdmin(prisma);
    sheetRows.push(
      { animal_id: "A001", sex: "Male", category: "Bull", current_camp: "kamp-1" },
      { animal_id: "A002", sex: "Female", category: "Cow", current_camp: "kamp-1" },
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/animals/import/route");
    const res = await POST(makeXlsxReq(), { params: Promise.resolve({}) });
    const sseText = await res.text();
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    const done = parseDoneFrame(sseText);
    expect(done.imported).toBe(1);
    expect(done.skipped).toBe(1);
    expect(done.errors).toHaveLength(1);
    // Actionable + typed: identifies the row/animal and says the save failed.
    expect(done.errors[0]).toContain("Row 2 (A001)");
    expect(done.errors[0]).toMatch(/database error/i);
    // The raw message must not appear ANYWHERE in the streamed body.
    expect(sseText).not.toContain("secret_col");
    expect(sseText).not.toContain("prisma.animal");
    expect(sseText).not.toContain(PRISMA_LEAK);
  });

  it("logs the full upsert error server-side so debugging detail is not lost", async () => {
    const prisma = makePrisma(new Set(["A001"]));
    primeAdmin(prisma);
    sheetRows.push({
      animal_id: "A001",
      sex: "Male",
      category: "Bull",
      current_camp: "kamp-1",
    });

    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const { POST } = await import("@/app/api/animals/import/route");
      const res = await POST(makeXlsxReq(), { params: Promise.resolve({}) });
      await res.text();

      const upsertLog = spy.mock.calls.find(([msg]) =>
        String(msg).includes("row upsert failed"),
      );
      expect(upsertLog).toBeDefined();
      const [, meta] = upsertLog! as [string, { error?: unknown }];
      expect(meta.error).toBe(PRISMA_LEAK);
    } finally {
      spy.mockRestore();
    }
  });
});
