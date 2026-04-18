// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, act, renderHook } from "@testing-library/react";

// Mock the storage module BEFORE importing the provider so the mocks are in
// place during the initial render's useEffect pass.
vi.mock("@/lib/onboarding/storage", () => ({
  loadOnboardingState: vi.fn(() => null),
  saveOnboardingState: vi.fn(),
  clearOnboardingState: vi.fn(),
}));

import {
  OnboardingProvider,
  useOnboarding,
} from "@/components/onboarding/OnboardingProvider";
import * as storage from "@/lib/onboarding/storage";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useOnboarding guard
// ---------------------------------------------------------------------------

describe("useOnboarding", () => {
  it("throws when called outside a provider", () => {
    // Suppress React's error log for the intentional render failure.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useOnboarding())).toThrow(
      /must be used within OnboardingProvider/,
    );
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Reducer behaviour via the public hook API
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <OnboardingProvider>{children}</OnboardingProvider>;
}

describe("OnboardingProvider state transitions", () => {
  it("setSpecies updates state.species", () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper });
    act(() => result.current.setSpecies("sheep"));
    expect(result.current.state.species).toBe("sheep");
  });

  it("setParsedFile clears proposal, overrides, importJobId, progress, and result", () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper });

    // Pollute downstream state first.
    act(() => {
      result.current.setProposal({
        proposal: {
          mapping: [],
          unmapped: [],
          warnings: [],
          row_count: 0,
          dictionary_version: "v1",
        },
        usage: {
          model: "gpt-4o-mini",
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          costUsd: 0,
          costZar: 0,
          totalTokens: 0,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      result.current.setMappingOverride("Kamp", "campId");
      result.current.setUnmappedOverride("Extra", "notes");
      result.current.setImportJobId("job-123");
      result.current.setProgress({ phase: "validating", processed: 1, total: 5 });
      result.current.setResult({ inserted: 1, skipped: 0, errors: [] });
    });

    act(() => {
      result.current.setParsedFile({
        file: { name: "x.xlsx", size: 100, hashHex: "abc" },
        parsedColumns: ["A"],
        sampleRows: [{ A: "1" }],
        fullRowCount: 1,
      });
    });

    expect(result.current.state.file).toMatchObject({ name: "x.xlsx" });
    expect(result.current.state.parsedColumns).toEqual(["A"]);
    expect(result.current.state.proposal).toBeNull();
    expect(result.current.state.mappingOverrides).toEqual({});
    expect(result.current.state.unmappedOverrides).toEqual({});
    expect(result.current.state.importJobId).toBeNull();
    expect(result.current.state.progress).toBeNull();
    expect(result.current.state.result).toBeNull();
  });

  it("reset returns state to INITIAL_STATE and clears persisted storage", () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper });

    act(() => {
      result.current.setSpecies("game");
      result.current.setMappingOverride("src", "tgt");
    });

    act(() => result.current.reset());

    expect(result.current.state.species).toBe("cattle");
    expect(result.current.state.mappingOverrides).toEqual({});
    expect(storage.clearOnboardingState).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

describe("OnboardingProvider hydration", () => {
  it("hydrates from sessionStorage on mount", () => {
    (storage.loadOnboardingState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      species: "sheep",
      parsedColumns: ["Ear Tag"],
    });

    const { result } = renderHook(() => useOnboarding(), { wrapper });

    // Effect runs synchronously under React 19's test renderer; species and
    // columns now reflect the loaded payload.
    expect(result.current.state.species).toBe("sheep");
    expect(result.current.state.parsedColumns).toEqual(["Ear Tag"]);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("OnboardingProvider persistence", () => {
  it("saves state on change, excluding sampleRows and progress", () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper });

    act(() => {
      result.current.setParsedFile({
        file: { name: "x.xlsx", size: 1, hashHex: "h" },
        parsedColumns: ["A"],
        sampleRows: [{ A: "1" }],
        fullRowCount: 1,
      });
    });

    // Find the latest save call (provider persists on every state change).
    const calls = (storage.saveOnboardingState as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls.length).toBeGreaterThan(0);

    const lastPayload = calls[calls.length - 1]![0];
    expect(lastPayload).not.toHaveProperty("sampleRows");
    expect(lastPayload).not.toHaveProperty("progress");
    // Everything else still present.
    expect(lastPayload).toHaveProperty("species");
    expect(lastPayload).toHaveProperty("parsedColumns", ["A"]);
    expect(lastPayload).toHaveProperty("fullRowCount", 1);
  });
});

// ---------------------------------------------------------------------------
// Provider render smoke test — children can consume the context without crashing.
// ---------------------------------------------------------------------------

describe("OnboardingProvider smoke", () => {
  function Consumer() {
    const { state } = useOnboarding();
    return <div data-testid="species">{state.species}</div>;
  }

  it("renders children and provides initial state", () => {
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>,
    );
    expect(screen.getByTestId("species")).toHaveTextContent("cattle");
  });
});
