// @vitest-environment jsdom
/**
 * Issue #482 (Epic A3 of PRD #479) — double-tap-safe logger submit.
 *
 * ROOT CAUSE: the logger weigh/repro forms have no SYNCHRONOUS guard against a
 * same-tick double-click.
 *   - `WeighingForm` (submit handler) had only a React-STATE `submitting`
 *     guard. `setSubmitting(true)` is async/batched, so a second click fired in
 *     the SAME tick — before React flushes and re-renders the disabled button —
 *     still sees `submitting === false` and enqueues a second observation.
 *   - `ReproductionForm` (`handleSubmit`) had NO submitting guard at all; its
 *     button stays enabled (`disabled={!canSubmit()}` is selection-based, not
 *     in-flight-based), so a double-tap fired `onSubmit` twice unconditionally.
 *
 * #480 makes RETRIES idempotent at the server; it deliberately does NOT
 * collapse two separate submits. Collapsing the same-tick double-submit is THIS
 * issue's job, at the form, via a synchronous `useRef` in-flight latch set
 * BEFORE any await.
 *
 * The test fires TWO synchronous clicks on the submit button back-to-back
 * (no `await` / no act flush between them, mirroring a real same-tick
 * double-tap) and asserts the parent `onSubmit` callback ran EXACTLY ONCE.
 * A single legitimate submit must still call `onSubmit` once (no regression).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";
import WeighingForm from "../WeighingForm";
import ReproductionForm from "../ReproductionForm";

afterEach(() => {
  cleanup();
});

describe("WeighingForm — synchronous in-flight latch (#482)", () => {
  it("enqueues only once on a same-tick double-tap", () => {
    // A never-resolving promise keeps the form in-flight across both clicks,
    // exactly as a real async enqueue would during the synchronous double-tap
    // window. The latch — not the resolution — must swallow the second click.
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    render(
      <WeighingForm animalTag="BB-001" onSubmit={onSubmit} onCancel={() => {}} />,
    );

    const input = screen.getByPlaceholderText("e.g. 245.5");
    fireEvent.change(input, { target: { value: "245.5" } });

    const button = screen.getByRole("button", { name: /submit weight/i });
    // Both clicks inside ONE act() batch so the `setSubmitting(true)` state
    // update does NOT flush between them — this is the genuine same-tick race
    // the React-state guard cannot win. Only the synchronous ref can swallow
    // the second invocation here.
    act(() => {
      button.click();
      button.click();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(
      <WeighingForm animalTag="BB-001" onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. 245.5"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit weight/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh submit after the prior one settles (latch resets)", async () => {
    let resolveFirst: (() => void) | null = null;
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((res) => (resolveFirst = () => res())),
      )
      .mockImplementation(() => Promise.resolve());

    render(
      <WeighingForm animalTag="BB-001" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    const input = screen.getByPlaceholderText("e.g. 245.5");

    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /saving|submit weight/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Let the first submit settle — the `finally` must clear the latch.
    await act(async () => {
      resolveFirst?.();
    });

    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /submit weight/i }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("ReproductionForm — synchronous in-flight latch (#482)", () => {
  function selectHeatFlow() {
    // Step 1: choose the Heat / Oestrus sub-flow.
    fireEvent.click(screen.getByRole("button", { name: /heat \/ oestrus/i }));
    // Step 2: pick a detection method so `canSubmit()` is satisfied.
    fireEvent.click(
      screen.getByRole("radio", { name: /visual observation/i }),
    );
  }

  it("submits only once on a same-tick double-tap", () => {
    const onSubmit = vi.fn();
    render(
      <ReproductionForm
        animalId="BB-001"
        animalSex="Female"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    selectHeatFlow();

    const button = screen.getByRole("button", { name: /record heat/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still submits once on a single legitimate tap (no regression)", () => {
    const onSubmit = vi.fn();
    render(
      <ReproductionForm
        animalId="BB-001"
        animalSex="Female"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    selectHeatFlow();
    fireEvent.click(screen.getByRole("button", { name: /record heat/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "heat_detection" }),
    );
  });
});
