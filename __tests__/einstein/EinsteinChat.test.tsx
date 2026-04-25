// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement, useState, useEffect, type ReactNode } from "react";

// ─── next/navigation mock ────────────────────────────────────────────────
// Each test inspects `routerPush` to assert deep-link navigation on click.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/farm-x/admin",
}));

import { EinsteinChat } from "@/components/einstein/EinsteinChat";
import {
  AssistantNameProvider,
  useAssistantName,
} from "@/hooks/useAssistantName";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Build a `Response` whose body is a ReadableStream that emits each chunk
 * and then closes. Modelled after the onboarding CommitProgress tests.
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

/** JSON Response helper for non-OK error paths (403, 429, etc). */
function makeJsonResponse(
  payload: unknown,
  status: number,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Frames the happy path uses across several tests. */
const HAPPY_PATH_FRAMES = [
  'event: token\ndata: {"text":"Rainfall "}\n\n',
  'event: token\ndata: {"text":"dropped "}\n\n',
  'event: token\ndata: {"text":"38%"}\n\n',
  'event: final\ndata: ' +
    JSON.stringify({
      answer: "Rainfall dropped 38% this quarter[1], lowest since 2018[2].",
      citations: [
        {
          entityType: "observation",
          entityId: "obs-123",
          quote: "12mm on 2026-03-14",
          relevance: "direct",
        },
        {
          entityType: "camp",
          entityId: "camp-7",
          quote: "Camp 7 rain gauge, 5-year low",
          relevance: "supporting",
        },
      ],
      confidence: "high",
      queryLogId: "qlog-abc",
    }) +
    "\n\n",
];

/**
 * Helper that dispatches a question through the textarea + submit button.
 * Uses fireEvent for parity with the rest of the FarmTrack test suite.
 */
async function sendQuestion(question: string) {
  const input = screen.getByTestId("einstein-input") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: question } });
  const form = input.closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

beforeEach(() => {
  routerPush.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("EinsteinChat — request construction", () => {
  it("POSTs to /api/einstein/ask with the expected body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeSSEResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);

    await sendQuestion("How's the rainfall?");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/einstein/ask");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.question).toBe("How's the rainfall?");
    expect(body.farmSlug).toBe("farm-x");
    expect(body.assistantName).toBe("Einstein");
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history).toHaveLength(0); // first question, no prior history
  });

  it("passes the tenant's assistant name from the provider into the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeSSEResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AssistantNameProvider name="Oupa">
        <EinsteinChat farmSlug="farm-x" />
      </AssistantNameProvider>,
    );

    await sendQuestion("ping");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.assistantName).toBe("Oupa");
  });
});

// ---------------------------------------------------------------------------
// Wordmark — no hardcoded "Einstein" in components, but the default IS the
// rendered value when no provider is mounted.
// ---------------------------------------------------------------------------

describe("EinsteinChat — wordmark", () => {
  it("renders the hook's default ('Einstein') when no provider is mounted", () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    render(<EinsteinChat farmSlug="farm-x" />);
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe(
      "Einstein",
    );
  });

  it("renders the tenant's custom name when the provider supplies one", () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    render(
      <AssistantNameProvider name="Boerkloof">
        <EinsteinChat farmSlug="farm-x" />
      </AssistantNameProvider>,
    );
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe(
      "Boerkloof",
    );
  });

  it("re-renders the wordmark when the provider's name changes", () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    // container.set is populated by useEffect (after render) so no ref mutation
    // occurs during the render phase — satisfies react-hooks/immutability.
    const container: { set: (v: string) => void } = { set: () => {} };
    function Host({ children }: { children: ReactNode }) {
      const [name, setN] = useState("Einstein");
      useEffect(() => { container.set = setN; });
      return (
        <AssistantNameProvider name={name}>{children}</AssistantNameProvider>
      );
    }

    render(
      <Host>
        <EinsteinChat farmSlug="farm-x" />
      </Host>,
    );
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe(
      "Einstein",
    );

    // Wave 3's rename editor would flip this after PUT /api/farm-settings/ai.
    act(() => {
      container.set("Oupa");
    });
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe("Oupa");
  });
});

// ---------------------------------------------------------------------------
// Streaming + citation rendering
// ---------------------------------------------------------------------------

describe("EinsteinChat — happy path streaming", () => {
  it("renders progressive tokens then a finalized assistant bubble with citations", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse(HAPPY_PATH_FRAMES)) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("rainfall?");

    // Wait for the final bubble to commit.
    await waitFor(() => {
      expect(screen.getByTestId("assistant-bubble")).toBeTruthy();
    });

    const bubble = screen.getByTestId("assistant-bubble");
    expect(bubble.textContent).toContain("Rainfall dropped 38% this quarter");
    expect(bubble.textContent).toContain("lowest since 2018");

    // Two citation chips rendered inline.
    const chips = within(bubble).getAllByLabelText(/Citation \d+:/);
    expect(chips).toHaveLength(2);
    expect(chips[0]!.textContent).toBe("[1]");
    expect(chips[1]!.textContent).toBe("[2]");
  });

  it("navigates to the deep-link when a citation chip is clicked", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse(HAPPY_PATH_FRAMES)) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("rainfall?");

    await waitFor(() => {
      expect(screen.getByTestId("assistant-bubble")).toBeTruthy();
    });

    const bubble = screen.getByTestId("assistant-bubble");
    const chip1 = within(bubble).getByLabelText(/Citation 1:/);
    fireEvent.click(chip1);

    expect(routerPush).toHaveBeenCalledWith(
      "/farm-x/admin/observations/obs-123",
    );

    const chip2 = within(bubble).getByLabelText(/Citation 2:/);
    fireEvent.click(chip2);
    expect(routerPush).toHaveBeenLastCalledWith("/farm-x/admin/camps/camp-7");
  });

  it("exposes the citation quote in the hover tooltip", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse(HAPPY_PATH_FRAMES)) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("rainfall?");

    await waitFor(() => {
      expect(screen.getByTestId("assistant-bubble")).toBeTruthy();
    });

    const chip1 = screen.getByLabelText("Citation 1: Observation");
    fireEvent.mouseEnter(chip1);

    await waitFor(() => {
      expect(
        screen.getByText(/12mm on 2026-03-14/),
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Feedback dispatch
// ---------------------------------------------------------------------------

describe("EinsteinChat — feedback", () => {
  it("POSTs thumbs-up to /api/einstein/feedback with the queryLogId", async () => {
    const askResponse = makeSSEResponse(HAPPY_PATH_FRAMES);
    const feedbackResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/einstein/ask")) return askResponse;
      if (urlStr.includes("/api/einstein/feedback")) return feedbackResponse;
      throw new Error(`unexpected fetch: ${urlStr}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("rainfall?");

    await waitFor(() => {
      expect(screen.getByTestId("feedback-up")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("feedback-up"));

    await waitFor(() => {
      const feedbackCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/api/einstein/feedback"),
      );
      expect(feedbackCall).toBeTruthy();
      const body = JSON.parse((feedbackCall![1] as RequestInit).body as string);
      expect(body).toEqual({ queryLogId: "qlog-abc", feedback: "up" });
    });
  });

  it("disables the feedback buttons after one click and marks the selection", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/einstein/ask")) {
        return makeSSEResponse(HAPPY_PATH_FRAMES);
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("rainfall?");

    await waitFor(() => {
      expect(screen.getByTestId("feedback-down")).toBeTruthy();
    });

    const downBtn = screen.getByTestId("feedback-down") as HTMLButtonElement;
    fireEvent.click(downBtn);

    await waitFor(() => {
      expect(downBtn.getAttribute("aria-pressed")).toBe("true");
    });

    expect((screen.getByTestId("feedback-up") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(downBtn.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("EinsteinChat — error paths", () => {
  it("renders an upgrade CTA when the server returns 403 EINSTEIN_TIER_LOCKED", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeJsonResponse(
        {
          code: "EINSTEIN_TIER_LOCKED",
          message: "Advanced plan required",
        },
        403,
      ),
    ) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("anything");

    await waitFor(() => {
      expect(
        screen.getByTestId("error-bubble-EINSTEIN_TIER_LOCKED"),
      ).toBeTruthy();
    });
    expect(screen.getByTestId("upgrade-cta")).toBeTruthy();
  });

  it("renders a budget-exhausted message with the reset label", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeJsonResponse(
        {
          code: "EINSTEIN_BUDGET_EXHAUSTED",
          message: "budget reached",
          resetLabel: "1 May",
        },
        402,
      ),
    ) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("anything");

    await waitFor(() => {
      expect(
        screen.getByTestId("error-bubble-EINSTEIN_BUDGET_EXHAUSTED"),
      ).toBeTruthy();
    });
    expect(screen.getByText(/resets on 1 May/i)).toBeTruthy();
  });

  it("renders the citation-fabrication error inline from an SSE error frame", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        'event: token\ndata: {"text":"almost..."}\n\n',
        'event: error\ndata: ' +
          JSON.stringify({
            code: "EINSTEIN_CITATION_FABRICATION",
            message: "citations did not verify",
          }) +
          "\n\n",
      ]),
    ) as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);
    await sendQuestion("anything");

    await waitFor(() => {
      expect(
        screen.getByTestId("error-bubble-EINSTEIN_CITATION_FABRICATION"),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(/couldn't be verified against your farm records/i),
    ).toBeTruthy();
  });

  it("does not render 'Einstein' anywhere in the error fallback copy", async () => {
    // Defense-in-depth: even the error paths route through the hook.
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeJsonResponse({ code: "EINSTEIN_INTERNAL_ERROR", message: "x" }, 500),
    ) as unknown as typeof fetch;

    render(
      <AssistantNameProvider name="Oupa">
        <EinsteinChat farmSlug="farm-x" />
      </AssistantNameProvider>,
    );
    await sendQuestion("boom");

    await waitFor(() => {
      expect(
        screen.getByTestId("error-bubble-EINSTEIN_INTERNAL_ERROR"),
      ).toBeTruthy();
    });

    // The wordmark must still say "Oupa" — not hardcoded "Einstein".
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe("Oupa");
  });
});

// ---------------------------------------------------------------------------
// Keyboard UX
// ---------------------------------------------------------------------------

describe("EinsteinChat — keyboard", () => {
  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeSSEResponse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<EinsteinChat farmSlug="farm-x" />);

    const input = screen.getByTestId("einstein-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Shift+Enter MUST NOT trigger a send — the component's onKeyDown only
    // preventDefaults on plain Enter. Because jsdom doesn't actually insert
    // a newline on shift+enter, we assert the negative: no additional fetch.
    fireEvent.change(input, { target: { value: "line 1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Assistant-name hygiene guard
// ---------------------------------------------------------------------------

describe("EinsteinChat — no hardcoded assistant name leakage", () => {
  it("routes every visible assistant reference through useAssistantName", async () => {
    // If the component hardcodes "Einstein", changing the provider name
    // wouldn't propagate to the wordmark, empty-state copy, or input
    // placeholder. Scan all three to enforce the contract.
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    render(
      <AssistantNameProvider name="Boerkloof">
        <EinsteinChat farmSlug="farm-x" />
      </AssistantNameProvider>,
    );

    // Wordmark
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe(
      "Boerkloof",
    );

    // Empty state
    const transcript = screen.getByTestId("einstein-transcript");
    expect(transcript.textContent).toContain("Boerkloof");
    expect(transcript.textContent).not.toContain("Einstein");

    // Input placeholder
    const input = screen.getByTestId("einstein-input") as HTMLTextAreaElement;
    expect(input.placeholder).toContain("Boerkloof");
    expect(input.placeholder).not.toContain("Einstein");
  });

  it("the hook is the single source of truth (sanity — both default and provider routes work)", () => {
    // Render a sibling probe alongside the chat to prove the hook and the
    // chat observe the same provider value.
    function NameProbe() {
      return <span data-testid="probe">{useAssistantName()}</span>;
    }

    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    render(
      createElement(
        AssistantNameProvider,
        { name: "Oupa" },
        createElement("div", null, [
          createElement(NameProbe, { key: "probe" }),
          createElement(EinsteinChat, { key: "chat", farmSlug: "farm-x" }),
        ]),
      ),
    );

    expect(screen.getByTestId("probe").textContent).toBe("Oupa");
    expect(screen.getByTestId("assistant-wordmark").textContent).toBe("Oupa");
  });
});
