// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { CommitProgress } from "@/components/onboarding/CommitProgress";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  ImportRow,
} from "@/lib/onboarding/client-types";

/**
 * Build a `Response` whose body is a ReadableStream that emits each of the
 * provided chunks synchronously before closing. Lets us exercise the
 * component's multi-frame buffer parser with surgical precision.
 */
function makeSSEResponse(
  chunks: string[],
  init: ResponseInit = { status: 200 },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

/**
 * Variant that never closes — useful for the unmount-abort test so the
 * in-flight fetch is truly in-flight when the component unmounts.
 */
function makePendingSSEResponse(signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener(
          "abort",
          () => {
            controller.error(new DOMException("Aborted", "AbortError"));
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      },
    });
    resolve(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });
}

const BASE_PROPS = {
  rows: [{ earTag: "A001" }] as ImportRow[],
  defaultSpecies: "cattle" as const,
  sourceFilename: "animals.xlsx",
  sourceFileHash: "abc123",
  mappingJson: JSON.stringify({ mapping: [] }),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("CommitProgress — request construction", () => {
  it("POSTs to /api/onboarding/commit-import with the expected body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeSSEResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <CommitProgress
        {...BASE_PROPS}
        importJobId="job-xyz"
        onProgress={() => {}}
        onComplete={() => {}}
        onError={() => {}}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/onboarding/commit-import");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      rows: BASE_PROPS.rows,
      defaultSpecies: "cattle",
      sourceFilename: "animals.xlsx",
      sourceFileHash: "abc123",
      // mappingJson is a STRING not an object — contract requirement for
      // server-side replay/debugging.
      mappingJson: BASE_PROPS.mappingJson,
      importJobId: "job-xyz",
    });
    expect(typeof body.mappingJson).toBe("string");
  });

  it("omits importJobId from body when not supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeSSEResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={() => {}}
        onComplete={() => {}}
        onError={() => {}}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty("importJobId");
  });
});

// ---------------------------------------------------------------------------
// Frame parsing — happy path
// ---------------------------------------------------------------------------

describe("CommitProgress — SSE frame dispatch", () => {
  it("dispatches progress, complete, and error events to the right callbacks", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        'event: progress\ndata: {"phase":"validating","processed":5,"total":10}\n\n',
        'event: complete\ndata: {"inserted":10,"skipped":0,"errors":[]}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onProgress = vi.fn<(p: CommitProgressFrame) => void>();
    const onComplete = vi.fn<(r: CommitResultFrame) => void>();
    const onError = vi.fn();

    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={onProgress}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenCalledWith({
      phase: "validating",
      processed: 5,
      total: 10,
    });
    expect(onComplete).toHaveBeenCalledWith({
      inserted: 10,
      skipped: 0,
      errors: [],
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("dispatches error events with the payload message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        'event: error\ndata: {"message":"boom"}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onError = vi.fn();
    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={() => {}}
        onComplete={() => {}}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });

  it("parses two progress frames concatenated into a single chunk", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        'event: progress\ndata: {"phase":"validating","processed":1,"total":10}\n\n' +
          'event: progress\ndata: {"phase":"inserting","processed":5,"total":10}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onProgress = vi.fn<(p: CommitProgressFrame) => void>();
    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={onProgress}
        onComplete={() => {}}
        onError={() => {}}
      />,
    );

    await waitFor(() => expect(onProgress).toHaveBeenCalledTimes(2));
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: "validating",
      processed: 1,
      total: 10,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      phase: "inserting",
      processed: 5,
      total: 10,
    });
  });

  it("buffers a partial frame until the trailing separator arrives", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        // Half of a frame…
        'event: progress\ndata: {"phase":"validating",',
        // …and the remainder including the terminating \n\n.
        '"processed":3,"total":10}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onProgress = vi.fn<(p: CommitProgressFrame) => void>();
    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={onProgress}
        onComplete={() => {}}
        onError={() => {}}
      />,
    );

    await waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenCalledWith({
      phase: "validating",
      processed: 3,
      total: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// Non-OK initial response
// ---------------------------------------------------------------------------

describe("CommitProgress — HTTP error response", () => {
  it("calls onError with the server error string and does not stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limit" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={onProgress}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith("rate limit"));
    expect(onProgress).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unmount aborts in-flight request
// ---------------------------------------------------------------------------

describe("CommitProgress — unmount", () => {
  it("aborts the in-flight fetch when the component unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return makePendingSSEResponse(capturedSignal);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = render(
      <CommitProgress
        {...BASE_PROPS}
        onProgress={() => {}}
        onComplete={() => {}}
        onError={() => {}}
      />,
    );

    // Wait for the fetch call so we know the AbortController was wired up.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
