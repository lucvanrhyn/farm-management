/**
 * @vitest-environment jsdom
 *
 * __tests__/app/admin/observations-subheader-copy.test.tsx
 *
 * Wave C / U5 — Codex audit P2 polish (2026-05-10).
 *
 * The admin Observations page subheader claimed "search, filter and edit"
 * but no search input was ever rendered — only a filter UI. Adding a real
 * search is OUT OF SCOPE for this wave (it's a feature, not polish), so
 * the fix is to make the copy match reality: "filter and edit".
 *
 * This test renders the SSR page with stubbed data deps and asserts the
 * literal subheader text. It also locks the negative — the page must NOT
 * promise a search affordance until one actually exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getFarmCredsMock = vi.fn();

vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));

// The page nests a client component + a destructive button. Stub both so
// the test focuses on the server-page's own JSX (the subheader copy).
vi.mock("@/components/admin/ClearSectionButton", () => ({
  default: () => null,
}));
vi.mock(
  "@/app/[farmSlug]/admin/observations/ObservationsPageClient",
  () => ({ default: () => null }),
);
vi.mock("@/components/admin/UpgradePrompt", () => ({ default: () => null }));

// AdminPage shell — keep the real shell so children render normally.
// (No mock needed; it's a pure React component with no server-only imports.)

async function renderPage() {
  const { default: Page } = await import(
    "@/app/[farmSlug]/admin/observations/page"
  );
  const element = await Page({
    params: Promise.resolve({ farmSlug: "trio-b" }),
  } as unknown as Parameters<typeof Page>[0]);
  return render(element as React.ReactElement);
}

describe("AdminObservationsPage subheader — Wave C / U5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
    getFarmModeMock.mockResolvedValue("cattle");
    getPrismaForFarmMock.mockResolvedValue({
      camp: { findMany: vi.fn().mockResolvedValue([]) },
      animal: { findMany: vi.fn().mockResolvedValue([]) },
    });
  });

  it("renders the corrected subheader: 'filter and edit'", async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain("filter and edit");
  });

  it("does NOT promise a 'search' affordance the page doesn't render", async () => {
    const { container } = await renderPage();
    // Match the original misleading copy fragment specifically rather than
    // every occurrence of the word "search" — accessibility labels or icons
    // added later may legitimately need the word elsewhere.
    expect(container.textContent ?? "").not.toContain("search, filter and edit");
  });
});
