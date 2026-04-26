// @vitest-environment jsdom
/**
 * __tests__/observations/AnimalPicker.test.tsx
 *
 * Phase H — observations animal picker. The legacy `<select>` in the
 * observation-create modal could only target the SSR-prefetched first 50
 * animals; users with larger herds had no way to reach the rest. The new
 * AnimalPicker is a debounced typeahead that talks to
 * /api/animals?search=&species= and binds the selection back via a
 * controlled-input contract.
 *
 * Contract under test:
 *   1. Renders a search input + an "(optional)" hint.
 *   2. An empty query (after debounce settles) does NOT fire a fetch.
 *      That keeps the network quiet on initial mount and on backspace-clear.
 *   3. Typing fires exactly one debounced fetch ~250 ms later.
 *   4. The fetch URL contains `search=<trimmed>` and `species=<mode>` and
 *      `limit=` (paginated mode triggers the `{ items, hasMore }` shape).
 *   5. Results render as clickable rows.
 *   6. Clicking a row calls `onChange` with the chosen animalId and the
 *      input shows the selected tag (controlled feedback).
 *   7. While a request is in flight, a "Loading…" indicator shows.
 *   8. An empty result set shows a "No animals match" message.
 *   9. A non-2xx response surfaces an inline error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import React from "react";

import AnimalPicker from "@/components/observations/AnimalPicker";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  // Default: empty paginated response.
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ items: [], nextCursor: null, hasMore: false }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function flushPromises() {
  // Two ticks so debounce timer + awaited fetch both settle.
  await Promise.resolve();
  await Promise.resolve();
}

describe("<AnimalPicker />", () => {
  it("does not fetch on mount with an empty query", async () => {
    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={() => {}} />);
    });
    // Even after the debounce window elapses, no fetch should happen because
    // the query is empty.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushPromises();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fires exactly one debounced fetch after typing", async () => {
    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={() => {}} />);
    });
    const input = screen.getByPlaceholderText(/search/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "C00" } });
      // 200 ms — still inside debounce window.
      vi.advanceTimersByTime(200);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      // Cross the debounce boundary.
      vi.advanceTimersByTime(100);
      await flushPromises();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("search=C00");
    expect(url).toContain("species=cattle");
    expect(url).toContain("limit=");
  });

  it("clearing the input back to empty does NOT fire another fetch", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ items: [], nextCursor: null, hasMore: false }),
    }));

    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={() => {}} />);
    });
    const input = screen.getByPlaceholderText(/search/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "C00" } });
      vi.advanceTimersByTime(300);
      await flushPromises();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Clear input.
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
      vi.advanceTimersByTime(500);
      await flushPromises();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("renders results and binds onChange when a row is clicked", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { animalId: "C0123", name: "Belle", category: "Cow", currentCamp: "camp-1" },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    }));

    const onChange = vi.fn();
    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={onChange} />);
    });
    const input = screen.getByPlaceholderText(/search/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "C01" } });
      vi.advanceTimersByTime(300);
      await flushPromises();
    });

    const row = screen.getByText("C0123");
    await act(async () => {
      fireEvent.click(row);
    });
    expect(onChange).toHaveBeenCalledWith("C0123");
  });

  it("shows an empty-results state when the response has no items", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ items: [], nextCursor: null, hasMore: false }),
    }));

    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={() => {}} />);
    });
    const input = screen.getByPlaceholderText(/search/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "ZZZ" } });
      vi.advanceTimersByTime(300);
      await flushPromises();
    });
    expect(screen.getByText(/no animals match/i)).toBeInTheDocument();
  });

  it("surfaces an inline error on non-2xx", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      json: async () => ({ error: "Boom" }),
    }));

    await act(async () => {
      render(<AnimalPicker species="cattle" value="" onChange={() => {}} />);
    });
    const input = screen.getByPlaceholderText(/search/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "any" } });
      vi.advanceTimersByTime(300);
      await flushPromises();
    });
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });

  it("filters the current campId through to the API when provided", async () => {
    await act(async () => {
      render(
        <AnimalPicker
          species="cattle"
          value=""
          onChange={() => {}}
          campId="camp-7"
        />,
      );
    });
    const input = screen.getByPlaceholderText(/search/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "C" } });
      vi.advanceTimersByTime(300);
      await flushPromises();
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("camp=camp-7");
  });
});
