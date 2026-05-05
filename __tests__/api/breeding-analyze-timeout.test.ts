/**
 * __tests__/api/breeding-analyze-timeout.test.ts
 *
 * P1 hotfix — deep-audit 2026-05-03.
 *
 * `app/api/[farmSlug]/breeding/analyze/route.ts` calls the OpenAI Chat
 * Completions API with a bare `fetch`. There is no client-side timeout, so
 * if OpenAI hangs (rate-limit, network blip, slow GPU pool), the Vercel
 * function holds its connection open until the platform's 60s hard kill.
 * During that window other requests on the same fn instance compete for
 * memory and the user gets a generic 504 from the platform — no app-level
 * triage signal.
 *
 * This test pins the contract:
 *   - When the upstream fetch never resolves within ~12s, the handler aborts
 *     it via `AbortController` and returns a typed JSON body.
 *   - Status is 504 (gateway timeout, semantically correct for upstream
 *     timeout — not 502, which we use for upstream-but-non-timeout errors).
 *   - Body shape matches `silent-failure-pattern.md`: `{ error, message }`
 *     with a stable error code (`UPSTREAM_TIMEOUT`, mirroring the existing
 *     constant in `app/api/map/gis/afis/route.ts:122`).
 *   - The handler does NOT hang — it must resolve within the soft timeout
 *     window, not be killed by the platform at 60s.
 *
 * See:
 *   - memory/silent-failure-pattern.md
 *   - memory/feedback-root-cause-over-quick-fix.md
 *   - app/api/map/gis/afis/route.ts (precedent for AbortController + UPSTREAM_TIMEOUT)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── farm-context ────────────────────────────────────────────────────────
const mockGetFarmContextForSlug = vi.fn();
vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: (...args: unknown[]) =>
    mockGetFarmContextForSlug(...args),
}));

// ── meta-db creds (live tier check) ────────────────────────────────────
const mockGetFarmCreds = vi.fn();
vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: (...args: unknown[]) => mockGetFarmCreds(...args),
}));

// ── farm mode ──────────────────────────────────────────────────────────
const mockGetFarmMode = vi.fn();
vi.mock("@/lib/server/get-farm-mode", () => ({
  getFarmMode: (...args: unknown[]) => mockGetFarmMode(...args),
}));

// ── breeding analytics (returns deterministic herd data) ───────────────
const mockGetBreedingSnapshot = vi.fn();
const mockSuggestPairings = vi.fn();
vi.mock("@/lib/server/breeding-analytics", () => ({
  getBreedingSnapshot: (...args: unknown[]) => mockGetBreedingSnapshot(...args),
  suggestPairings: (...args: unknown[]) => mockSuggestPairings(...args),
}));

// ── rate-limit (always allow in tests) ─────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}));

// ── logger (silence error logs in CI) ──────────────────────────────────
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── prisma fixtures ────────────────────────────────────────────────────
const mockFarmSettingsFindFirst = vi.fn();
const mockObservationFindMany = vi.fn();
const mockPrisma = {
  farmSettings: { findFirst: mockFarmSettingsFindFirst },
  observation: { findMany: mockObservationFindMany },
};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetFarmContextForSlug.mockResolvedValue({
    prisma: mockPrisma,
    slug: "delta-livestock",
    role: "admin",
  });
  mockGetFarmCreds.mockResolvedValue({
    slug: "delta-livestock",
    tier: "advanced",
  });
  mockGetFarmMode.mockResolvedValue("cattle");
  mockGetBreedingSnapshot.mockResolvedValue({
    bullsInService: 2,
    pregnantCows: 50,
    openCows: 20,
    expectedCalvingsThisMonth: 5,
    calendarEntries: [],
  });
  mockSuggestPairings.mockResolvedValue({ pairings: [] });
  mockFarmSettingsFindFirst.mockResolvedValue({
    openaiApiKey: "sk-test-key",
    breedingSeasonStart: null,
    breedingSeasonEnd: null,
  });
  mockObservationFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const buildRequest = () =>
  new NextRequest("http://localhost/api/delta-livestock/breeding/analyze", {
    method: "POST",
  });

const buildParams = () =>
  Promise.resolve({ farmSlug: "delta-livestock" });

describe("POST /api/[farmSlug]/breeding/analyze — OpenAI timeout contract", () => {
  it("aborts upstream fetch after the soft timeout and returns 504 + UPSTREAM_TIMEOUT body", async () => {
    // Stub global fetch to honour AbortSignal: stays pending until aborted,
    // then rejects with a DOMException-shaped AbortError. This models a real
    // OpenAI hang (rate-limit, slow GPU, network blip).
    const fetchStub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hang forever; would never resolve
        if (signal.aborted) {
          reject(makeAbortError());
          return;
        }
        signal.addEventListener("abort", () => reject(makeAbortError()));
      });
    });
    vi.stubGlobal("fetch", fetchStub);

    vi.useFakeTimers();

    const { POST } = await import(
      "@/app/api/[farmSlug]/breeding/analyze/route"
    );

    const responsePromise = POST(buildRequest(), { params: buildParams() });

    // Drain the microtask queue so the handler reaches the `await fetch(...)`
    // call (and registers its setTimeout for the abort) before we advance
    // time. Without this, `advanceTimersByTime` fires before the abort timer
    // is even scheduled and the test would deadlock.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Fast-forward past 12s — the soft timeout the fix installs. We allow a
    // generous window (15s) to keep the test resilient to a 12-15s tunable.
    await vi.advanceTimersByTimeAsync(15_000);

    const res = await responsePromise;

    expect(res.status).toBe(504);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("UPSTREAM_TIMEOUT");
    expect(typeof body.message).toBe("string");
    expect(body.message?.length ?? 0).toBeGreaterThan(0);

    // Sanity: fetch was actually called with an AbortSignal.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });

  it("does not abort when upstream responds inside the soft timeout (regression-lock)", async () => {
    // Happy path: the AbortController fix must not break successful calls.
    const fetchStub = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "ok",
                  bullRecommendations: [],
                  calvingAlerts: [],
                  breedingWindowSuggestion: "ok",
                  riskFlags: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchStub);

    const { POST } = await import(
      "@/app/api/[farmSlug]/breeding/analyze/route"
    );

    const res = await POST(buildRequest(), { params: buildParams() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary?: string };
    expect(body.summary).toBe("ok");
  });
});

// AbortError factory — mirrors what the runtime fetch throws when the abort
// signal fires (DOMException with name "AbortError"). Using a plain Error
// with `.name = "AbortError"` is what the route's catch-block matches on.
function makeAbortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}
