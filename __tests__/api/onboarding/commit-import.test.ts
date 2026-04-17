import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — declared before route import
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

const importJobCreateMock = vi.fn();
const importJobFindUniqueMock = vi.fn();
const getPrismaWithAuthMock = vi.fn();
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: (...args: unknown[]) => getPrismaWithAuthMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

const commitImportMock = vi.fn();
vi.mock("@/lib/onboarding/commit-import", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/commit-import")
  >("@/lib/onboarding/commit-import");
  return {
    ...actual,
    commitImport: (...args: unknown[]) => commitImportMock(...args),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown, raw = false) {
  return new NextRequest("http://localhost/api/onboarding/commit-import", {
    method: "POST",
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_PROVENANCE = {
  sourceFilename: "animals.csv",
  sourceFileHash: "abc123",
  mappingJson: '{"earTag":"id_number"}',
};

const validBody = {
  rows: [
    { earTag: "A001", sex: "Female" as const, birthDate: "2023-01-01" },
    { earTag: "A002", sex: "Male" as const },
  ],
  defaultSpecies: "cattle",
  ...VALID_PROVENANCE,
};

type ProgressFn = (p: {
  phase: string;
  processed: number;
  total: number;
}) => void;

function primeHappyMocks(opts: { role?: string } = {}) {
  getServerSessionMock.mockResolvedValue({
    user: { email: "luc@example.com", name: "Luc", farms: [] },
  });
  importJobCreateMock.mockResolvedValue({ id: "job-new-id" });
  getPrismaWithAuthMock.mockResolvedValue({
    prisma: {
      importJob: {
        create: importJobCreateMock,
        findUnique: importJobFindUniqueMock,
      },
    },
    slug: "basson-boerdery",
    role: opts.role ?? "ADMIN",
  });
  checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 });
  commitImportMock.mockImplementation(
    async (
      _prisma: unknown,
      _input: unknown,
      onProgress?: ProgressFn,
    ) => {
      onProgress?.({ phase: "validating", processed: 2, total: 2 });
      onProgress?.({ phase: "inserting", processed: 2, total: 2 });
      onProgress?.({ phase: "done", processed: 2, total: 2 });
      return { inserted: 2, skipped: 0, errors: [] };
    },
  );
}

async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Minimal SSE frame parser — splits on the blank-line delimiter and pulls the
 * `event:` / `data:` fields out of each frame. Good enough for asserting the
 * sequence of event names the route emits.
 */
function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  return raw
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      let parsed: unknown = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        // leave as string if not JSON
      }
      return { event, data: parsed };
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/onboarding/commit-import", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    getPrismaWithAuthMock.mockReset();
    importJobCreateMock.mockReset();
    importJobFindUniqueMock.mockReset();
    checkRateLimitMock.mockReset();
    commitImportMock.mockReset();
  });

  it("returns 401 when there is no session", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the farm role is not ADMIN", async () => {
    primeHappyMocks({ role: "VIEWER" });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(403);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("propagates getPrismaWithAuth error status", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: "luc@example.com", farms: [] },
    });
    getPrismaWithAuthMock.mockResolvedValue({
      error: "No active farm selected",
      status: 400,
    });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(400);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded (body is valid)", async () => {
    primeHappyMocks();
    checkRateLimitMock.mockReturnValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(commitImportMock).not.toHaveBeenCalled();
    expect(importJobCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    primeHappyMocks();
    const req = new NextRequest(
      "http://localhost/api/onboarding/commit-import",
      {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      },
    );
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 400 when rows is empty", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, rows: [] }),
    );
    expect(res.status).toBe(400);
    expect(commitImportMock).not.toHaveBeenCalled();
    // body validation runs BEFORE rate-limit (B3 hardening)
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 400 when rows exceeds the 10_000 hard cap", async () => {
    primeHappyMocks();
    const tooMany = Array.from({ length: 10_001 }, (_, i) => ({
      earTag: `X${i}`,
    }));
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, rows: tooMany }),
    );
    expect(res.status).toBe(400);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 400 when defaultSpecies is not in the allowlist", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, defaultSpecies: "llama" }),
    );
    expect(res.status).toBe(400);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 400 when importJobId is an empty string", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, importJobId: "" }),
    );
    expect(res.status).toBe(400);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // HIGH #1 — provenance fields required when creating a new ImportJob
  // -------------------------------------------------------------------------

  it("returns 400 when creating a new ImportJob without sourceFilename", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const { sourceFilename: _omit, ...bodyMissing } = validBody;
    const res = await POST(makeReq(bodyMissing));
    expect(res.status).toBe(400);
    expect(importJobCreateMock).not.toHaveBeenCalled();
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 400 when creating a new ImportJob without sourceFileHash", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const { sourceFileHash: _omit, ...bodyMissing } = validBody;
    const res = await POST(makeReq(bodyMissing));
    expect(res.status).toBe(400);
    expect(importJobCreateMock).not.toHaveBeenCalled();
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 400 when creating a new ImportJob without mappingJson", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const { mappingJson: _omit, ...bodyMissing } = validBody;
    const res = await POST(makeReq(bodyMissing));
    expect(res.status).toBe(400);
    expect(importJobCreateMock).not.toHaveBeenCalled();
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 400 when mappingJson is not valid JSON", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, mappingJson: "{not-json" }),
    );
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toMatch(/mappingJson/);
    expect(importJobCreateMock).not.toHaveBeenCalled();
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // MEDIUM #2 — ownership check on reused importJobId
  // -------------------------------------------------------------------------

  it("returns 404 when reused importJobId does not exist", async () => {
    primeHappyMocks();
    importJobFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, importJobId: "missing-job" }),
    );
    expect(res.status).toBe(404);
    expect(commitImportMock).not.toHaveBeenCalled();
    expect(importJobCreateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when reused importJobId belongs to a different farm", async () => {
    primeHappyMocks();
    importJobFindUniqueMock.mockResolvedValue({
      id: "cross-tenant-job",
      status: "running",
      farmId: "other-farm",
    });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, importJobId: "cross-tenant-job" }),
    );
    expect(res.status).toBe(403);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("returns 409 when reused importJobId is already complete", async () => {
    primeHappyMocks();
    importJobFindUniqueMock.mockResolvedValue({
      id: "done-job",
      status: "complete",
      farmId: "basson-boerdery",
    });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, importJobId: "done-job" }),
    );
    expect(res.status).toBe(409);
    expect(commitImportMock).not.toHaveBeenCalled();
  });

  it("uses a per-farm rate-limit key scoped to commit-import", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    // Drain the stream so the route runs to completion.
    await readStream(res);
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1);
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0];
    expect(key).toBe("commit-import:basson-boerdery");
    expect(max).toBe(3);
    expect(windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("happy path: creates ImportJob, streams progress, then complete", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const body = await readStream(res);
    const events = parseSSE(body);

    const names = events.map((e) => e.event);
    expect(names).toContain("progress");
    expect(names[names.length - 1]).toBe("complete");

    const complete = events[events.length - 1];
    expect(complete.data).toEqual({ inserted: 2, skipped: 0, errors: [] });

    // ImportJob auto-created with farmId = slug and confirmedBy from session,
    // and the provenance fields passed through verbatim (no defaults).
    expect(importJobCreateMock).toHaveBeenCalledTimes(1);
    const createArg = importJobCreateMock.mock.calls[0][0].data;
    expect(createArg.farmId).toBe("basson-boerdery");
    expect(createArg.confirmedBy).toBe("luc@example.com");
    expect(createArg.status).toBe("running");
    expect(createArg.sourceFilename).toBe(VALID_PROVENANCE.sourceFilename);
    expect(createArg.sourceFileHash).toBe(VALID_PROVENANCE.sourceFileHash);
    expect(createArg.mappingJson).toBe(VALID_PROVENANCE.mappingJson);

    // commitImport receives the freshly-minted job id.
    expect(commitImportMock).toHaveBeenCalledTimes(1);
    const [, input] = commitImportMock.mock.calls[0];
    expect(input.importJobId).toBe("job-new-id");
    expect(input.defaultSpecies).toBe("cattle");
    expect(input.rows).toHaveLength(2);
  });

  it("reuses a caller-supplied importJobId instead of creating one", async () => {
    primeHappyMocks();
    importJobFindUniqueMock.mockResolvedValue({
      id: "existing-job-42",
      status: "running",
      farmId: "basson-boerdery",
    });
    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(
      makeReq({ ...validBody, importJobId: "existing-job-42" }),
    );
    await readStream(res);

    expect(importJobCreateMock).not.toHaveBeenCalled();
    expect(commitImportMock).toHaveBeenCalledTimes(1);
    expect(commitImportMock.mock.calls[0][1].importJobId).toBe(
      "existing-job-42",
    );
  });

  it("emits an error frame and closes the stream when commitImport throws", async () => {
    primeHappyMocks();
    commitImportMock.mockImplementationOnce(
      async (
        _prisma: unknown,
        _input: unknown,
        onProgress?: ProgressFn,
      ) => {
        onProgress?.({ phase: "validating", processed: 1, total: 2 });
        throw new Error("db offline — raw detail that must not leak");
      },
    );

    const { POST } = await import(
      "@/app/api/onboarding/commit-import/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);

    const body = await readStream(res);
    const events = parseSSE(body);
    const names = events.map((e) => e.event);
    expect(names).toContain("progress");
    expect(names[names.length - 1]).toBe("error");
    expect(names).not.toContain("complete");

    const errFrame = events[events.length - 1];
    expect(errFrame.data).toEqual({ message: "Import failed" });
    // Generic message only — raw exception text must NOT leak to the client.
    expect(JSON.stringify(errFrame.data)).not.toContain("db offline");
  });

  // -------------------------------------------------------------------------
  // HIGH #2 — commitImport timeout
  // -------------------------------------------------------------------------

  describe("when commitImport exceeds the 90s timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("emits an error frame with a timeout-specific message", async () => {
      primeHappyMocks();
      // commitImport hangs forever — only the timeout should resolve the race.
      commitImportMock.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      const { POST } = await import(
        "@/app/api/onboarding/commit-import/route"
      );
      const res = await POST(makeReq(validBody));
      expect(res.status).toBe(200);

      // Start reading the body in parallel so the stream's start() runs and
      // sets up the setTimeout before we advance fake timers.
      const bodyPromise = readStream(res);

      // Yield microtasks so the ReadableStream start() executes and registers
      // the timeout before we advance the clock.
      await vi.advanceTimersByTimeAsync(91_000);

      const body = await bodyPromise;
      const events = parseSSE(body);
      const names = events.map((e) => e.event);
      expect(names[names.length - 1]).toBe("error");
      expect(names).not.toContain("complete");

      const errFrame = events[events.length - 1];
      const data = errFrame.data as { message: string };
      expect(data.message).toMatch(/timed out/i);
    });
  });
});
