// @vitest-environment jsdom
/**
 * Issue #459 (PRD #455) — MobsManager species-context state-from-props bug.
 *
 * Same anti-pattern fixed for AnimalsTable in #456
 * (__tests__/admin/animals-table-state-from-props-regression.test.tsx).
 *
 * Repro: the admin Mob Management page is rendered by
 * `app/[farmSlug]/admin/mobs/page.tsx`, which fetches mobs with
 * `scoped(prisma, mode).mob.findMany(...)` — the `Mob` table has a
 * `species` column, so the SSR'd `initialMobs` prop is species-scoped.
 * The page lives below `FarmModeProvider` (app/[farmSlug]/layout.tsx).
 * Flipping the ModeSwitcher calls `setMode` → `router.refresh()`, which
 * re-renders the page Server Component with the NEW species' mobs and
 * passes fresh `initialMobs` — but MobsManager is NOT remounted.
 *
 * Root cause: `MobsManager.tsx`
 *
 *     const [mobs, setMobs] = useState<Mob[]>(initialMobs);
 *
 * `useState(initialMobs)` reads the prop ONLY at mount, so after the
 * refresh the table body keeps rendering the PRIOR species' mob rows
 * while everything around it (page header mob count, etc.) reflects the
 * new species.
 *
 * Fix: `useResyncOnPropChange(initialMobs, () => initialMobs)` — re-seed
 * local state the moment the SSR'd mobs payload changes (React's "adjusting
 * state on a prop change" recipe), mirroring AnimalsTable. The trigger is
 * the `initialMobs` prop itself because the mobs page does not pass a
 * discrete `species` prop; a species flip produces a fresh `initialMobs`
 * array from `scoped(prisma, mode).mob.findMany`, so the reference change
 * drives the re-sync.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/trio-b-boerdery/admin/mobs",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// The active mode flips with the prop; MobsManager reads it via
// useFarmModeSafe but the regression is about the prop-seeded `mobs` state,
// so a stable mock value is sufficient.
vi.mock("@/lib/farm-mode", () => ({
  useFarmModeSafe: () => ({ mode: "cattle" }),
}));

// The "add animal to mob" picker fires its own paginated fetch on mount —
// stub it out so the test focuses on the mobs table body.
vi.mock("@/components/admin/AddAnimalToMobPicker", () => ({
  default: () => null,
}));

type FakeMob = {
  id: string;
  name: string;
  current_camp: string;
  animal_count: number;
};

function fakeMobs(species: "cattle" | "sheep", count: number): FakeMob[] {
  const prefix = species === "cattle" ? "Cattle Mob" : "Sheep Mob";
  return Array.from({ length: count }, (_, i) => ({
    id: `${species}-mob-${i + 1}`,
    name: `${prefix} ${i + 1}`,
    current_camp: "camp-1",
    animal_count: 10,
  }));
}

const camps = [{ camp_id: "camp-1", camp_name: "Camp 1" }];

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MobsManager — mobs[] re-syncs when initialMobs prop changes (router.refresh after ModeSwitcher)", () => {
  it("renders the NEW species' mob rows after the props change, not the prior species' stale rows", async () => {
    const { default: MobsManager } = await import(
      "@/components/admin/MobsManager"
    );

    // First render: SSR delivered sheep mode with zero mobs (e.g. trio-b's
    // sheep have no mobs yet).
    const { rerender } = render(
      <MobsManager
        initialMobs={fakeMobs("sheep", 0) as never}
        camps={camps as never}
        membership={[] as never}
        farmSlug="trio-b-boerdery"
      />,
    );

    // Empty state for the sheep species.
    expect(screen.getByText(/no mobs yet/i)).toBeTruthy();

    // User clicks Cattle in the ModeSwitcher. setMode writes the cookie and
    // calls router.refresh(). The page Server Component re-renders with
    // mode=cattle, SSR fetches 3 cattle mobs, and MobsManager receives a
    // fresh `initialMobs` array (new reference) but is NOT remounted.
    rerender(
      <MobsManager
        initialMobs={fakeMobs("cattle", 3) as never}
        camps={camps as never}
        membership={[] as never}
        farmSlug="trio-b-boerdery"
      />,
    );

    // BUG (pre-fix): `useState(initialMobs)` never re-seeds, so the empty
    // state stays and the cattle mobs never render. These assertions fail
    // under the current implementation — locking the regression class.
    expect(screen.queryByText(/no mobs yet/i)).toBeNull();
    expect(screen.getByText("Cattle Mob 1")).toBeTruthy();
    expect(screen.getByText("Cattle Mob 2")).toBeTruthy();
    expect(screen.getByText("Cattle Mob 3")).toBeTruthy();
    // No stale sheep rows leaked through.
    expect(screen.queryByText(/sheep mob/i)).toBeNull();
  });
});
