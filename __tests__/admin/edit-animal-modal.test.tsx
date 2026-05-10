/**
 * @vitest-environment jsdom
 *
 * Wave B / E1 — Codex audit 2026-05-10 found that admin animal "Edit"
 * lands users on a read-only detail page with only Sell/Death actions.
 * The PATCH /api/animals/[id] endpoint already accepts every identity
 * field (name, sex, dateOfBirth, breed, currentCamp, motherId, fatherId,
 * registrationNumber, tagNumber, brandSequence) for ADMIN — the gap is
 * purely UI: nothing in the app surfaces an edit form.
 *
 * Contract this test enforces:
 *   - EditAnimalModal renders inputs for the editable identity fields.
 *   - Submitting issues PATCH /api/animals/<id> with the changed fields.
 *   - Cancel closes the modal without firing a request.
 *   - On success, the parent's onSaved callback runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh, replace: vi.fn() }),
}));

import EditAnimalModal from "@/app/[farmSlug]/admin/animals/[id]/_components/EditAnimalModal";
import type { Animal, Camp } from "@prisma/client";

const fixtureAnimal: Pick<
  Animal,
  | "animalId"
  | "name"
  | "sex"
  | "dateOfBirth"
  | "breed"
  | "currentCamp"
  | "motherId"
  | "fatherId"
  | "registrationNumber"
  | "tagNumber"
  | "brandSequence"
  | "category"
  | "species"
  | "status"
> = {
  animalId: "BB-C014",
  name: "Bella",
  sex: "Female",
  dateOfBirth: "2022-04-12",
  breed: "Bonsmara",
  currentCamp: "speenkamp",
  motherId: null,
  fatherId: null,
  registrationNumber: null,
  tagNumber: "T-014",
  brandSequence: null,
  category: "Cow",
  species: "cattle",
  status: "Active",
};

const fixtureCamps: Pick<Camp, "campId" | "campName">[] = [
  { campId: "speenkamp", campName: "Speenkamp" },
  { campId: "kwarantyn", campName: "Kwarantyn" },
];

describe("EditAnimalModal — E1 admin edit affordance", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    // jsdom doesn't ship fetch by default
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...fixtureAnimal, name: "Bella II" }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders editable identity inputs pre-filled from the animal", () => {
    render(
      <EditAnimalModal
        animal={fixtureAnimal as unknown as Animal}
        camps={fixtureCamps as unknown as Camp[]}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    const name = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(name.value).toBe("Bella");

    const tag = screen.getByLabelText(/tag/i) as HTMLInputElement;
    expect(tag.value).toBe("T-014");

    const breed = screen.getByLabelText(/breed/i) as HTMLInputElement;
    expect(breed.value).toBe("Bonsmara");

    // Camp picker — confirm both camps appear as options.
    const campSelect = screen.getByLabelText(/camp/i) as HTMLSelectElement;
    const optionValues = Array.from(campSelect.options).map((o) => o.value);
    expect(optionValues).toContain("speenkamp");
    expect(optionValues).toContain("kwarantyn");
    expect(campSelect.value).toBe("speenkamp");
  });

  it("PATCHes /api/animals/<id> with only the changed fields on save", async () => {
    const onSaved = vi.fn();
    render(
      <EditAnimalModal
        animal={fixtureAnimal as unknown as Animal}
        camps={fixtureCamps as unknown as Camp[]}
        open
        onClose={() => {}}
        onSaved={onSaved}
      />
    );

    const name = screen.getByLabelText(/^name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Bella II" } });

    const submit = screen.getByRole("button", { name: /save/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/animals/BB-C014");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // Only the changed field is sent — keeps the patch minimal and avoids
    // accidentally re-validating fields the user didn't touch.
    expect(body).toEqual({ name: "Bella II" });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("does NOT issue a request when the user cancels", () => {
    const onClose = vi.fn();
    render(
      <EditAnimalModal
        animal={fixtureAnimal as unknown as Animal}
        camps={fixtureCamps as unknown as Camp[]}
        open
        onClose={onClose}
        onSaved={() => {}}
      />
    );

    const cancel = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <EditAnimalModal
        animal={fixtureAnimal as unknown as Animal}
        camps={fixtureCamps as unknown as Camp[]}
        open={false}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(container.querySelector("input")).toBeNull();
  });
});
