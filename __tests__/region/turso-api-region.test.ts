// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// In-memory capture of every `databases.create` call made by createTursoDatabase.
// We build this as a vi.fn before mocking so the mock factory can close over it.
const createCalls: Array<{ name: string; opts: Record<string, unknown> }> = [];
const createTokenCalls: string[] = [];

vi.mock("@tursodatabase/api", () => ({
  createClient: () => ({
    databases: {
      create: vi.fn(async (name: string, opts: Record<string, unknown>) => {
        createCalls.push({ name, opts });
        return { hostname: `${name}.aws-eu-central-1.turso.io` };
      }),
      createToken: vi.fn(async (name: string) => {
        createTokenCalls.push(name);
        return { jwt: "test-jwt" };
      }),
      delete: vi.fn(),
    },
  }),
}));

beforeEach(() => {
  createCalls.length = 0;
  createTokenCalls.length = 0;
  process.env.TURSO_API_TOKEN = "test-token";
  process.env.TURSO_ORG = "test-org";
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("createTursoDatabase region routing", () => {
  it("provisions new farms in Frankfurt by default (Phase E target)", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");

    const result = await createTursoDatabase("new-farm-slug");

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].name).toBe("new-farm-slug");
    expect(createCalls[0].opts.location).toBe("fra");
    expect(result.url).toContain("aws-eu-central-1");
  });

  it("accepts an explicit `location` override for operators running migrations", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");

    await createTursoDatabase("manual-migration", { location: "nrt" });

    expect(createCalls[0].opts.location).toBe("nrt");
  });

  it("reads FARM_DEFAULT_TURSO_LOCATION env override when no explicit location is passed", async () => {
    process.env.FARM_DEFAULT_TURSO_LOCATION = "iad";
    try {
      const { createTursoDatabase } = await import("@/lib/turso-api");
      await createTursoDatabase("env-override");
      expect(createCalls[0].opts.location).toBe("iad");
    } finally {
      delete process.env.FARM_DEFAULT_TURSO_LOCATION;
    }
  });

  it("always requests a full-access token under the new farm name", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");
    await createTursoDatabase("audit-check");
    expect(createTokenCalls).toEqual(["audit-check"]);
  });
});
