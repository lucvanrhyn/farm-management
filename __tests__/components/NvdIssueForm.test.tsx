// @vitest-environment jsdom
/**
 * __tests__/components/NvdIssueForm.test.tsx
 *
 * TDD tests for wave-26 regulatory hotfix:
 *   Fix 4 — NvdIssueForm must collect transport fields:
 *            driverName, vehicleRegNumber, vehicleMakeModel
 *
 * Audit NVD table rows 6+7 (Stock Theft Act §8): driver/transporter name
 * and vehicle registration are mandatory for any roadblock inspection.
 *
 * These fields are optional at the type level but the form MUST render them
 * so the user knows to fill them in.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Mock fetch — the component calls /api/animals on mount and /api/{farmSlug}/nvd/validate
// on selection change. We don't want real network calls in unit tests.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [], // empty animals list by default
  }));
});

// Lazy import after fetch mock is in place
async function renderForm() {
  const { default: NvdIssueForm } = await import(
    "@/components/nvd/NvdIssueForm"
  );
  return render(
    <NvdIssueForm
      farmSlug="test-farm"
      onIssued={vi.fn()}
    />,
  );
}

// ── Fix 4: Transport fields present in the form ───────────────────────────────

describe("NvdIssueForm — Fix 4: transport fields", () => {
  it("renders an input for driverName", async () => {
    await renderForm();
    await waitFor(() => {
      const input = document.querySelector('input[name="driverName"]');
      expect(input, "input[name=driverName] not found in NvdIssueForm").not.toBeNull();
    });
  });

  it("renders an input for vehicleRegNumber", async () => {
    await renderForm();
    await waitFor(() => {
      const input = document.querySelector('input[name="vehicleRegNumber"]');
      expect(input, "input[name=vehicleRegNumber] not found in NvdIssueForm").not.toBeNull();
    });
  });

  it("renders an input for vehicleMakeModel", async () => {
    await renderForm();
    await waitFor(() => {
      const input = document.querySelector('input[name="vehicleMakeModel"]');
      expect(input, "input[name=vehicleMakeModel] not found in NvdIssueForm").not.toBeNull();
    });
  });

  it("renders a transport section label visible to the user", async () => {
    await renderForm();
    await waitFor(() => {
      // The section heading "Transport" (case-insensitive) must be visible
      const heading = screen.queryByText(/transport/i);
      expect(heading, "No visible 'Transport' section label found in NvdIssueForm").not.toBeNull();
    });
  });

  it("driverName input has a user-visible placeholder or label", async () => {
    await renderForm();
    await waitFor(() => {
      const input = document.querySelector('input[name="driverName"]') as HTMLInputElement | null;
      expect(input).not.toBeNull();
      // Either a placeholder attribute or an associated label should exist
      const hasPlaceholder = input!.placeholder && input!.placeholder.length > 0;
      const hasLabel =
        input!.labels && input!.labels.length > 0 ||
        input!.getAttribute("aria-label") !== null ||
        document.querySelector(`label[for="${input!.id}"]`) !== null;
      expect(
        hasPlaceholder || hasLabel,
        "driverName input has no placeholder or label — user won't know what to fill in"
      ).toBe(true);
    });
  });
});

// ── Existing form fields still present ───────────────────────────────────────

describe("NvdIssueForm — existing fields not broken", () => {
  it("still renders Sale Date input", async () => {
    await renderForm();
    await waitFor(() => {
      const input = document.querySelector('input[type="date"]');
      expect(input).not.toBeNull();
    });
  });

  it("still renders Buyer Name input", async () => {
    await renderForm();
    await waitFor(() => {
      const input = screen.queryByPlaceholderText(/full name of buyer/i);
      expect(input).not.toBeNull();
    });
  });

  it("renders the Issue NVD submit button", async () => {
    await renderForm();
    await waitFor(() => {
      const btn = screen.queryByRole("button", { name: /issue nvd/i });
      expect(btn).not.toBeNull();
    });
  });
});
