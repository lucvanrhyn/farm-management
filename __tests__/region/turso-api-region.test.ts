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
  it("provisions new farms in Ireland by default (Phase E target, post-Frankfurt-retirement)", async () => {
    // 2026-04-24: Turso retired Frankfurt before our cutover. Ireland
    // (aws-eu-west-1 / short code "dub") is the new target. Short codes
    // must be translated to full AWS IDs because the mgmt API silently
    // rejects the legacy short forms.
    const { createTursoDatabase } = await import("@/lib/turso-api");

    const result = await createTursoDatabase("new-farm-slug");

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].name).toBe("new-farm-slug");
    expect(createCalls[0].opts.location).toBe("aws-eu-west-1");
    expect(createCalls[0].opts.group).toBe("eu-dub");
    expect(result.url).toContain("aws-eu-central-1"); // fixture returns a fake hostname
  });

  it("accepts an explicit `location` override for operators running migrations", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");

    await createTursoDatabase("manual-migration", { location: "nrt" });

    // Short code translates to full AWS ID + its registered group.
    expect(createCalls[0].opts.location).toBe("aws-ap-northeast-1");
    expect(createCalls[0].opts.group).toBe("default");
  });

  it("passes a full AWS ID through verbatim when caller already has one", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");
    await createTursoDatabase("already-translated", { location: "aws-eu-west-1" });
    expect(createCalls[0].opts.location).toBe("aws-eu-west-1");
    expect(createCalls[0].opts.group).toBe("eu-dub");
  });

  it("reads FARM_DEFAULT_TURSO_LOCATION env override when no explicit location is passed", async () => {
    process.env.FARM_DEFAULT_TURSO_LOCATION = "nrt";
    try {
      const { createTursoDatabase } = await import("@/lib/turso-api");
      await createTursoDatabase("env-override");
      expect(createCalls[0].opts.location).toBe("aws-ap-northeast-1");
      expect(createCalls[0].opts.group).toBe("default");
    } finally {
      delete process.env.FARM_DEFAULT_TURSO_LOCATION;
    }
  });

  it("throws a helpful error if asked to provision into a region with no group registered", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");
    await expect(
      createTursoDatabase("no-group", { location: "iad" }),
    ).rejects.toThrow(/No Turso group registered for region "iad"/);
  });

  it("always requests a full-access token under the new farm name", async () => {
    const { createTursoDatabase } = await import("@/lib/turso-api");
    await createTursoDatabase("audit-check");
    expect(createTokenCalls).toEqual(["audit-check"]);
  });
});
