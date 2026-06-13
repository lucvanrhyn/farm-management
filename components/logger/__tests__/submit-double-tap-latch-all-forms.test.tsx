// @vitest-environment jsdom
/**
 * S6 (OS-3 / obs-L1) — single in-flight submit latch on ALL logger forms.
 *
 * ROOT CAUSE (confirmed against code): `clientLocalId` is minted PER-ENQUEUE
 * at the `queueObservation` chokepoint (#480), so two distinct submits get two
 * distinct idempotency keys → two server rows. The #482 synchronous in-flight
 * latch was only added to WeighingForm (strong: ref held across the await) and
 * ReproductionForm (weak: ref cleared on the next macrotask via setTimeout(0),
 * so a real double-tap ~100-300ms apart still fires twice). The remaining
 * forms had NO latch at all:
 *   - TreatmentForm: React-STATE `submitting` guard only — a same-tick second
 *     click sees the stale closure and enqueues again.
 *   - HealthIssueForm / MovementForm / CalvingForm / DeathModal: no guard of
 *     any kind; fire-and-forget `onSubmit` runs once per click.
 *   - CampCoverLogForm: state-only guard (pre-#482 WeighingForm shape). Its
 *     mount-stable clientLocalId (#207) collapses the duplicate server-side,
 *     but the same-tick race still double-queues locally.
 *
 * NOT covered here on purpose:
 *   - WeighingForm — already has the reference latch (pinned by
 *     `submit-double-tap-latch.test.tsx`).
 *   - CampConditionForm — its #206 contract (mount-stable UUID REUSED across
 *     two clicks so the server upsert collapses both POSTs) is pinned by
 *     `__tests__/components/camp-condition-form-idempotency.test.tsx`; the
 *     project's chosen defense for that form is the idempotency key.
 *   - MobMoveModal — the offline mob-move path is rewritten wholesale by S8.
 *
 * Pattern mirror of `submit-double-tap-latch.test.tsx`: two synchronous
 * clicks inside ONE act() batch model the genuine same-tick double-tap that a
 * React-state guard cannot win — only a synchronous ref can swallow click #2.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";
import TreatmentForm from "../TreatmentForm";
import HealthIssueForm from "../HealthIssueForm";
import MovementForm from "../MovementForm";
import CalvingForm from "../CalvingForm";
import DeathModal from "../DeathModal";
import CampCoverLogForm from "../CampCoverLogForm";
import ReproductionForm from "../ReproductionForm";

// MovementForm reads the camps list from the OfflineProvider context.
vi.mock("@/components/logger/OfflineProvider", () => ({
  useOffline: () => ({
    camps: [
      { camp_id: "camp-a", camp_name: "Camp A" },
      { camp_id: "camp-b", camp_name: "Camp B" },
    ],
  }),
}));

// CalvingForm seeds its breed field from the cached farm settings on mount.
vi.mock("@/lib/offline-store", () => ({
  getCachedFarmSettings: vi.fn(async () => null),
}));

afterEach(() => {
  cleanup();
});

/** A promise that never settles — keeps the submit in-flight across clicks. */
function pendingForever(): Promise<void> {
  return new Promise<void>(() => {});
}

/**
 * A pre-handled rejected promise. The test attaches its own `.catch` so the
 * rejection is never "unhandled" even on the pre-fix code path where no form
 * code awaits it.
 */
function rejectedQueueWrite(): Promise<void> {
  const p = Promise.reject(new Error("IDB write failed"));
  p.catch(() => {});
  return p;
}

function doubleTap(button: HTMLElement): void {
  act(() => {
    button.click();
    button.click();
  });
}

// ── TreatmentForm ─────────────────────────────────────────────────────────────

describe("TreatmentForm — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <TreatmentForm animalTag="BB-001" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. Terramycin"), {
      target: { value: "Terramycin" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 5ml"), {
      target: { value: "5ml" },
    });
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /submit treatment/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /submit treatment/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("releases the latch once the prior submit settles (fresh submit works)", async () => {
    let resolveFirst: (() => void) | null = null;
    const onSubmit = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((res) => (resolveFirst = () => res())),
      )
      .mockImplementation(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /saving|submit treatment/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
    });

    // Form resets on success — refill before the second legitimate submit.
    fireEvent.change(screen.getByPlaceholderText("e.g. Terramycin"), {
      target: { value: "Dectomax" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 5ml"), {
      target: { value: "2ml" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit treatment/i }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

// ── HealthIssueForm ───────────────────────────────────────────────────────────

describe("HealthIssueForm — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <HealthIssueForm
        animalId="BB-001"
        campId="camp-a"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^lame$/i }));
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /submit report/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ symptoms: ["Lame"] }),
    );
  });
});

// ── MovementForm ──────────────────────────────────────────────────────────────

describe("MovementForm — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <MovementForm
        animalId="BB-001"
        sourceCampId="camp-a"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /camp b/i }));
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /confirm move/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /confirm move/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ destCampId: "camp-b" }),
    );
  });

  it("releases the latch on failure — error surfaced, retry possible (no stuck button)", async () => {
    const onSubmit = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(rejectedQueueWrite)
      .mockImplementation(() => Promise.resolve());
    renderFilled(onSubmit);

    await act(async () => {
      screen.getByRole("button", { name: /confirm move|saving/i }).click();
    });

    // Failure must be surfaced, not silently swallowed.
    expect(screen.getByText(/failed to queue/i)).toBeTruthy();

    // Latch released — a deliberate retry goes through.
    fireEvent.click(screen.getByRole("button", { name: /confirm move/i }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

// ── CalvingForm ───────────────────────────────────────────────────────────────

describe("CalvingForm — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <CalvingForm
        animalId="BB-001"
        campId="camp-a"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. T-2024-001"), {
      target: { value: "T-2026-042" },
    });
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /record birth/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /record birth/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ calfAnimalId: "T-2026-042" }),
    );
  });
});

// ── DeathModal ────────────────────────────────────────────────────────────────

describe("DeathModal — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <DeathModal
        isOpen
        animalId="BB-001"
        causes={["Old age", "Predation"]}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /old age/i }));
    fireEvent.change(screen.getByLabelText(/carcass disposal/i), {
      target: { value: "BURIED" },
    });
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /record death/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /record death/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "Old age", carcassDisposal: "BURIED" }),
    );
  });
});

// ── CampCoverLogForm ──────────────────────────────────────────────────────────

describe("CampCoverLogForm — synchronous in-flight latch (S6 / OS-3)", () => {
  function renderFilled(onSubmit: () => Promise<void>) {
    render(
      <CampCoverLogForm campName="Camp A" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /good/i }));
  }

  it("enqueues only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn(pendingForever);
    renderFilled(onSubmit);

    doubleTap(screen.getByRole("button", { name: /record cover/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderFilled(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: /record cover/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ── ReproductionForm — the weak 0ms variant ──────────────────────────────────

describe("ReproductionForm — latch held across macrotasks while in flight (S6 / obs-L1)", () => {
  function selectHeatFlow() {
    fireEvent.click(screen.getByRole("button", { name: /heat \/ oestrus/i }));
    fireEvent.click(screen.getByRole("radio", { name: /visual observation/i }));
  }

  it("swallows a realistic double-tap that lands on a LATER macrotask while the submit is still in flight", async () => {
    // Pre-fix the ref was cleared via setTimeout(0), so any second tap after
    // ~0ms (i.e. every real-world double-tap) fired onSubmit again.
    const onSubmit = vi.fn(pendingForever);
    render(
      <ReproductionForm
        animalId="BB-001"
        animalSex="Female"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    selectHeatFlow();

    const button = screen.getByRole("button", { name: /record heat|saving/i });
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Cross a macrotask boundary — the 0ms variant has released by now.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("releases the latch on failure — error surfaced, retry possible (no stuck button)", async () => {
    const onSubmit = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(rejectedQueueWrite)
      .mockImplementation(() => Promise.resolve());
    render(
      <ReproductionForm
        animalId="BB-001"
        animalSex="Female"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    selectHeatFlow();

    await act(async () => {
      screen.getByRole("button", { name: /record heat|saving/i }).click();
    });

    expect(screen.getByText(/failed to queue/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /record heat/i }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
