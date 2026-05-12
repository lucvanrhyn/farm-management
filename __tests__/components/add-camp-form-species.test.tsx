// @vitest-environment jsdom
/**
 * Wave 4 — issue #232: AddCampForm forces explicit species pick.
 *
 * Acceptance criteria covered:
 *   - Form renders a species picker with cattle / sheep (game when enabled).
 *   - Default selection equals current FarmMode but user must acknowledge by
 *     interacting with the field. The form refuses to submit until the user
 *     has confirmed the species (touched the field or checked the confirm
 *     box) — no silent inherit-from-mode.
 *   - On a single-species farm (e.g. Basson — cattle-only) the picker is
 *     hidden but the payload still carries `species: "cattle"`.
 *   - When the user switches the picker from cattle → sheep, the POST body
 *     contains `species: "sheep"`.
 *
 * The component reads `useFarmModeSafe()` for default mode and
 * `enabledModes` / `isMultiMode`. We render inside `FarmModeProvider` to
 * control both inputs deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

import { FarmModeProvider } from "@/lib/farm-mode";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // jsdom doesn't ship a `fetch` by default in this project's setup, but if
  // anything else seeded it, we overwrite for deterministic capture.
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  cleanup();
});

async function renderWithMode(
  enabledSpecies: readonly string[],
  initialMode: "cattle" | "sheep" | "game",
) {
  // Seed localStorage so the provider's lazy initializer picks the desired
  // initial mode. The provider's STORAGE_KEY_PREFIX is `farmtrack-mode-`.
  localStorage.setItem(`farmtrack-mode-test-farm`, initialMode);
  const { default: AddCampForm } = await import("@/components/admin/AddCampForm");
  return render(
    <FarmModeProvider farmSlug="test-farm" enabledSpecies={enabledSpecies}>
      <AddCampForm />
    </FarmModeProvider>,
  );
}

async function openForm() {
  fireEvent.click(screen.getByText(/Add Camp/i));
}

function fillRequiredText() {
  fireEvent.change(screen.getByPlaceholderText(/K1/), { target: { value: "K1" } });
  fireEvent.change(screen.getByPlaceholderText(/Kamp 1/), { target: { value: "Kamp 1" } });
}

describe("AddCampForm — species picker (#232)", () => {
  it("refuses to submit when species has not been explicitly confirmed (multi-species farm)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await renderWithMode(["cattle", "sheep"], "cattle");
    await openForm();
    fillRequiredText();

    // User has NOT touched the species field — submit must be blocked.
    fireEvent.click(screen.getByText(/Save Camp/i));

    await waitFor(() => {
      // The form must surface an inline error and must NOT have called fetch.
      // The hint+inline-error both mention "confirm species", so use *AllByText
      // to assert the message is present without requiring uniqueness.
      expect(fetchMock).not.toHaveBeenCalled();
      const matches = screen.getAllByText(/confirm species/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("submits with species='sheep' after the user switches the picker (multi-species farm)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await renderWithMode(["cattle", "sheep"], "cattle");
    await openForm();
    fillRequiredText();

    // Switch species via the radio input (cattle → sheep). Clicking the
    // sheep radio counts as the explicit acknowledgement.
    const sheepRadio = screen.getByLabelText(/sheep/i) as HTMLInputElement;
    fireEvent.click(sheepRadio);

    fireEvent.click(screen.getByText(/Save Camp/i));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/camps");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.species).toBe("sheep");
    expect(body.campId).toBe("K1");
  });

  it("submits with species='cattle' when the user explicitly confirms the default", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await renderWithMode(["cattle", "sheep"], "cattle");
    await openForm();
    fillRequiredText();

    // Re-click the already-checked cattle radio — counts as acknowledgement.
    const cattleRadio = screen.getByLabelText(/cattle/i) as HTMLInputElement;
    fireEvent.click(cattleRadio);

    fireEvent.click(screen.getByText(/Save Camp/i));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.species).toBe("cattle");
  });

  it("hides the picker on a single-species farm but still posts species=cattle", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await renderWithMode(["cattle"], "cattle");
    await openForm();
    fillRequiredText();

    // Picker must NOT be rendered as a radio group for a single-species farm.
    expect(screen.queryByLabelText(/sheep/i)).toBeNull();

    // Submit should succeed without any explicit confirmation step, because
    // there is structurally only one valid choice.
    fireEvent.click(screen.getByText(/Save Camp/i));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.species).toBe("cattle");
  });
});
