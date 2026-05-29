// @vitest-environment jsdom
/**
 * Issue #481 — the admin "+ New Entry" modal POSTs directly to
 * /api/observations (it does NOT route through the offline queue that
 * defaults a `clientLocalId` per #480). Pre-#481 the modal sent no
 * `clientLocalId`, so a double-click on "Create" (or a network retry)
 * created TWO Observation rows — the admin-path analogue of stress-test H1.
 *
 * Fix: mint a mount-stable idempotency key (`useState(() => crypto.randomUUID())`,
 * mirroring CampConditionForm:165 / RecordBirthButton:31) and include it in the
 * POST body. The server upserts on Observation.clientLocalId (UNIQUE idx,
 * migration 0019), so duplicate/retried POSTs collapse to a single row.
 *
 * These tests pin:
 *  1. The modal sends a non-empty `clientLocalId` in the request body.
 *  2. A double-click on Create reuses the SAME key (one logical write).
 *  3. A fresh mount (modal reopened) uses a NEW key, so a deliberate second
 *     entry is not collapsed into the first.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

// AnimalPicker does its own debounced /api/animals fetch — stub it out so the
// test exercises only the modal's submit path.
vi.mock("@/components/observations/AnimalPicker", () => ({
  default: () => null,
}));

import CreateObservationModal from "../CreateObservationModal";

const CAMPS = [{ id: "camp-1", name: "North Camp" }];

function postBodies(): Array<Record<string, unknown>> {
  const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls
    .filter(([url]) => String(url) === "/api/observations")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function renderModal() {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  render(
    <CreateObservationModal
      camps={CAMPS}
      animals={[]}
      species="cattle"
      onSuccess={onSuccess}
      onCancel={onCancel}
    />,
  );
  return { onSuccess, onCancel };
}

/** Walk the modal to a submittable state: pick a type, then a camp. */
async function fillToSubmittable() {
  // Step 1 — pick the "Camp Condition" type (no animal required, simple form).
  fireEvent.click(screen.getByText("Camp Condition"));
  // Step 2 — select the required camp.
  const campSelect = await screen.findByRole("combobox", { name: /camp/i });
  fireEvent.change(campSelect, { target: { value: "camp-1" } });
}

describe("CreateObservationModal — idempotent admin create (#481)", () => {
  beforeEach(() => {
    let n = 0;
    // Deterministic UUIDs so we can assert sameness/difference across mounts.
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => `uuid-${++n}` as `${string}-${string}-${string}-${string}-${string}`,
    );
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "obs-1" }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sends a non-empty clientLocalId in the POST body", async () => {
    const { onSuccess } = renderModal();
    await fillToSubmittable();

    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const bodies = postBodies();
    expect(bodies).toHaveLength(1);
    expect(typeof bodies[0].clientLocalId).toBe("string");
    expect(bodies[0].clientLocalId).toBeTruthy();
  });

  it("reuses ONE key across a double-click on Create", async () => {
    renderModal();
    await fillToSubmittable();

    const createBtn = screen.getByRole("button", { name: /create/i });
    // Two synchronous clicks before the first request resolves — the classic
    // double-submit. Both must carry the identical mount-stable key so the
    // server upsert collapses them to a single row.
    await act(async () => {
      fireEvent.click(createBtn);
      fireEvent.click(createBtn);
    });

    const bodies = postBodies();
    const keys = new Set(bodies.map((b) => b.clientLocalId));
    // However many POSTs the UI emits, they share ONE idempotency key.
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBeTruthy();
  });

  it("uses a NEW key on a fresh mount (reopened modal)", async () => {
    // First mount + submit.
    const first = renderModal();
    await fillToSubmittable();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(first.onSuccess).toHaveBeenCalled());
    const firstKey = postBodies()[0].clientLocalId;

    // Modal unmounts on success (parent flips showCreate=false), then a fresh
    // "+ New Entry" remounts it. Simulate by unmounting and rendering again.
    // Clear the shared fetch mock's call history so postBodies() below reads
    // only the SECOND mount's request, not the first.
    cleanup();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockClear();

    const second = renderModal();
    await fillToSubmittable();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(second.onSuccess).toHaveBeenCalled());
    const secondKey = postBodies()[0].clientLocalId;

    expect(secondKey).not.toBe(firstKey);
  });
});
