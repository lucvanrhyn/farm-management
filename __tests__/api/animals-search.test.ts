import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      email: "user-1@example.com",
      role: "admin",
      farms: [{ slug: "test-farm-slug", role: "admin" }],
    },
  }),
}));

const mockFindMany = vi.fn();
const mockPrisma = {
  animal: { findMany: mockFindMany },
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: "test-farm-slug",
    role: "admin",
  }),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("GET /api/animals — search filter (phase I.2)", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
  });

  it("adds an OR clause across animalId+name when ?search is present (paginated mode)", async () => {
    const { GET } = await import("@/app/api/animals/route");

    const req = new NextRequest(
      "http://localhost/api/animals?limit=50&search=C001",
    );
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const args = mockFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number;
    };
    // Status filter preserved.
    expect(args.where).toMatchObject({ status: "Active" });
    // `search` maps to an OR across animalId and name.
    expect(args.where.OR).toEqual([
      { animalId: { contains: "C001" } },
      { name: { contains: "C001" } },
    ]);
    // Take/limit handling unchanged.
    expect(args.take).toBe(51);
  });

  it("ignores empty ?search values", async () => {
    const { GET } = await import("@/app/api/animals/route");

    const req = new NextRequest(
      "http://localhost/api/animals?limit=50&search=",
    );
    await GET(req);

    const args = mockFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.OR).toBeUndefined();
  });

  it("composes search with other filters (camp + mobId=null for unassigned picker)", async () => {
    const { GET } = await import("@/app/api/animals/route");

    const req = new NextRequest(
      "http://localhost/api/animals?limit=50&search=Belle&unassigned=1",
    );
    await GET(req);

    const args = mockFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      status: "Active",
      mobId: null,
    });
    expect(args.where.OR).toEqual([
      { animalId: { contains: "Belle" } },
      { name: { contains: "Belle" } },
    ]);
  });
});
