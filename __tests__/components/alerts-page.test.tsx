// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

import AlertSettingsForm, {
  type FarmAlertSettings,
} from "@/components/admin/AlertSettingsForm";

// next/navigation is not used by the form directly but some imported libs
// may pull it in; stub defensively.
vi.mock("next/navigation", () => ({
  usePathname: () => "/delta-livestock/admin/settings/alerts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Capture fetch calls to assert the form posts the right payload to PATCH.
const mockFetch = vi.fn();

const DEFAULT_SETTINGS: FarmAlertSettings = {
  quietHoursStart: "20:00",
  quietHoursEnd: "06:00",
  timezone: "Africa/Johannesburg",
  speciesAlertThresholds: null,
};

function installSuccessFetch() {
  mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
    // Echo the request back so optimistic updates settle. The component
    // does not rely on this shape exactly — it just needs success:true.
    const body = opts.body ? JSON.parse(opts.body as string) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        prefs: body.prefs ?? [],
        farmSettings: { ...DEFAULT_SETTINGS, ...body },
      }),
    };
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  installSuccessFetch();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
  // Use fake timers so the 500ms debounce can be flushed deterministically.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderForm(
  overrides: Partial<React.ComponentProps<typeof AlertSettingsForm>> = {},
) {
  return render(
    <AlertSettingsForm
      farmSlug="delta-livestock"
      isAdmin={true}
      initialPrefs={[]}
      initialFarmSettings={DEFAULT_SETTINGS}
      {...overrides}
    />,
  );
}

describe("<AlertSettingsForm />", () => {
  it("renders every category row with all four channels + a digest select", () => {
    renderForm();
    // Categories from the wireframe.
    expect(screen.getByText("Reproduction")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("Veld / Grazing")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Compliance")).toBeInTheDocument();
    expect(screen.getByText("Weather / Rainfall")).toBeInTheDocument();
    expect(screen.getByText("Predator losses")).toBeInTheDocument();

    // Seven categories × four channels = 28 checkboxes in the matrix.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(28);
  });

  it("WhatsApp toggles are disabled (Advanced tier only)", () => {
    renderForm();
    const whatsappBoxes = screen.getAllByRole("checkbox", { name: /whatsapp/i });
    // 7 categories × 1 whatsapp column = 7 disabled boxes.
    expect(whatsappBoxes.length).toBe(7);
    for (const el of whatsappBoxes) {
      expect(el).toBeDisabled();
    }
  });

  it("predator digest select is disabled (safety floor)", () => {
    renderForm();
    const digestSelect = screen.getByRole("combobox", {
      name: /predator losses digest mode/i,
    });
    expect(digestSelect).toBeDisabled();
  });

  it("clicking an enabled checkbox fires a PATCH to /api/[slug]/settings/alerts with the new state", async () => {
    // Use real timers here — the debounce is short (500ms) and fake-timer
    // interaction with React 19 + jsdom's microtask queue is fragile.
    vi.useRealTimers();
    renderForm();
    const target = screen.getByRole("checkbox", { name: "Reproduction Bell" });
    fireEvent.click(target);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/delta-livestock/settings/alerts");
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body as string) as {
      prefs: Array<{ category: string; channel: string; enabled: boolean }>;
    };
    // Mutated row shows category+channel of the click.
    const reproBell = body.prefs.find(
      (p) => p.category === "reproduction" && p.channel === "bell",
    );
    expect(reproBell).toBeDefined();
  });

  it("non-admin cannot change quiet hours — input is disabled", () => {
    renderForm({ isAdmin: false });
    const startInput = screen.getByLabelText("Quiet hours start") as HTMLInputElement;
    expect(startInput).toBeDisabled();
    const endInput = screen.getByLabelText("Quiet hours end") as HTMLInputElement;
    expect(endInput).toBeDisabled();
    const tzSelect = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(tzSelect).toBeDisabled();
  });

  it("shows per-species override picker with cattle/sheep/game options", () => {
    renderForm();
    const speciesSelect = screen.getByLabelText("Species override") as HTMLSelectElement;
    expect(speciesSelect).toBeInTheDocument();
    expect(speciesSelect.querySelectorAll("option").length).toBe(4); // None + 3 species
  });
});
