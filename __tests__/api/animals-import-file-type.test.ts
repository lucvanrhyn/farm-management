/**
 * Adversarial Bug 2 (HIGH) — `app/api/animals/import/route.ts` advertises
 * `.xlsx,.xls,.csv` (line 55-65) but the xlsx-shim only knows how to load
 * `.xlsx` (`wb.xlsx.load()`). A user uploading a CSV or legacy `.xls` file
 * gets past the allowlist, then the shim throws at `readWorkbook(buffer)`
 * with an unhandled error → unhelpful 500 (or stream that never starts).
 *
 * Root-cause fix: narrow the contract. Reject anything that isn't `.xlsx`
 * with a typed-error 400 per `silent-failure-pattern.md` BEFORE the shim
 * is invoked, and update the dropzones' accept attribute to match.
 *
 * RED: this test posts a CSV; today the route accepts it and downstream
 * blows up. After the fix the route returns 400 with code FILE_TYPE_UNSUPPORTED.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormDataReq(file: File): NextRequest {
  const fd = new FormData();
  fd.append("file", file);
  return new NextRequest("http://localhost/api/animals/import", {
    method: "POST",
    body: fd,
  });
}

function primeAdmin() {
  getFarmContextMock.mockResolvedValue({
    prisma: {} as never,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "luc@example.com" } },
  });
}

beforeEach(() => {
  getFarmContextMock.mockReset();
  verifyFreshAdminRoleMock.mockReset();
  verifyFreshAdminRoleMock.mockResolvedValue(true);
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockReturnValue({ allowed: true });
  primeAdmin();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/animals/import — Bug 2 file-type contract", () => {
  it("rejects a CSV upload with 400 + FILE_TYPE_UNSUPPORTED code", async () => {
    const { POST } = await import("@/app/api/animals/import/route");

    const csv = new File(["animal_id,sex\nA001,Male\n"], "animals.csv", {
      type: "text/csv",
    });
    const res = await POST(makeFormDataReq(csv), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    const body = await res.json();
    // Canonical typed envelope (ADR-0001): `error` is the SCREAMING_SNAKE
    // code; the human sentence lives in `message`.
    expect(body.error).toBe("FILE_TYPE_UNSUPPORTED");
    expect(body.message).toMatch(/\.xlsx/i);
    expect(body.message).toMatch(/csv|xls/i);
  });

  it("rejects a legacy .xls (BIFF8) upload with 400 + FILE_TYPE_UNSUPPORTED code", async () => {
    const { POST } = await import("@/app/api/animals/import/route");

    const xls = new File(["legacy bytes"], "old-book.xls", {
      type: "application/vnd.ms-excel",
    });
    const res = await POST(makeFormDataReq(xls), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("FILE_TYPE_UNSUPPORTED");
  });

  it("does not blow up when someone uploads renamed binary garbage with .xlsx extension — the shim throws and the route surfaces 400", async () => {
    // A corrupt download (or any non-spreadsheet binary) renamed `data.xlsx`
    // passes the extension check but fails at readWorkbook. The route MUST
    // translate that to a typed 400, not let it fall through as a 500.
    // (silent-failure-pattern.md.)
    //
    // S13 / OB-csv note: this scenario originally used renamed CSV *text*,
    // which threw when the shim was xlsx-only. readWorkbook now sniffs bytes
    // and parses text payloads through its CSV path (same row model), so a
    // renamed CSV no longer throws — binary garbage pins the catch path.
    const { POST } = await import("@/app/api/animals/import/route");

    // PNG magic bytes — invalid UTF-8 lead byte, not a zip container.
    const fakeXlsx = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "data.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
    const res = await POST(makeFormDataReq(fakeXlsx), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("FILE_PARSE_FAILED");
  });
});
