// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Behaviour under test: when a user lands on /subscribe/complete without a
 * `?farm=<slug>` query parameter, the page must fast-fail with an actionable
 * error UI instead of running the 24-second silent polling loop.
 *
 * Real users hit the missing-param branch on:
 *   - saved bookmarks
 *   - failed PayFast return URLs (gateway strips query params)
 *   - manual URL entry / link sharing
 *   - browser back/forward causing re-render with cleared state
 *
 * The original `poll()` function checked `if (farmSlug) { ... }` so when
 * farmSlug was null the loop would tick 12 times (24 s) with no useful work,
 * then drop into the ambiguous "Payment received / try signing in again"
 * timeout state.
 *
 * Acceptance criteria:
 *   - Missing `?farm=` → an error heading is rendered immediately (no
 *     polling, no `update()` call, no fetch to /api/subscription/status).
 *   - The error provides a CTA back to a recoverable page (`/farms` or
 *     `/login`).
 *   - The happy path (`?farm=basson-boerdery` present) is unchanged: the
 *     polling spinner is rendered.
 */

const updateMock = vi.fn();
const pushMock = vi.fn();
const fetchMock = vi.fn();

let searchParams = new URLSearchParams();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update: updateMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

beforeEach(() => {
  updateMock.mockReset();
  pushMock.mockReset();
  fetchMock.mockReset();
  // Default to a never-resolving fetch so we can assert it was *not* called
  // on the missing-param path. The happy path tests stub a real response.
  fetchMock.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loadPage(): Promise<React.ComponentType> {
  const mod = await import("@/app/subscribe/complete/page");
  return mod.default;
}

describe("/subscribe/complete — missing farm slug", () => {
  it("renders an actionable error instead of the polling spinner when ?farm= is absent", async () => {
    searchParams = new URLSearchParams(); // no farm
    const Page = await loadPage();
    render(<Page />);

    // Should NOT be the polling/refreshing UI.
    expect(screen.queryByText(/Confirming payment/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Please wait while PayFast confirms your subscription/i),
    ).not.toBeInTheDocument();

    // Should be a clear error explaining the missing context.
    const errorMessage = await screen.findByText(
      /couldn't identify your farm/i,
    );
    expect(errorMessage).toBeInTheDocument();

    // CTA button leading the user out of the dead end.
    const cta = screen.getByRole("button", {
      name: /go to my farms|return to dashboard|go to dashboard|sign in/i,
    });
    expect(cta).toBeInTheDocument();
  });

  it("does not call session.update() or fetch /api/subscription/status when ?farm= is absent", async () => {
    searchParams = new URLSearchParams();
    const Page = await loadPage();
    render(<Page />);

    // Wait a tick so any rogue useEffect would have run.
    await waitFor(() => {
      expect(
        screen.queryByText(/couldn't identify your farm/i),
      ).toBeInTheDocument();
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still renders the polling spinner on the happy path (?farm= present)", async () => {
    searchParams = new URLSearchParams("farm=basson-boerdery");
    const Page = await loadPage();
    render(<Page />);

    expect(screen.getByText(/Confirming payment/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Please wait while PayFast confirms your subscription/i),
    ).toBeInTheDocument();

    // The missing-farm error must NOT appear on the happy path.
    expect(
      screen.queryByText(/couldn't identify your farm/i),
    ).not.toBeInTheDocument();
  });
});
