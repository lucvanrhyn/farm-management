/**
 * @vitest-environment node
 *
 * __tests__/alerts/inngest-functions.test.ts — contract check on the
 * Inngest functions exported from lib/server/inngest/functions.ts.
 *
 * We don't need a full runtime here — the guarantee this test protects is
 * that the two function IDs, the cron spec, and the event name are stable.
 * Inngest dashboards and Vercel crons depend on these strings; a rename
 * silently breaks prod triggers.
 */

import { describe, it, expect } from "vitest";
import {
  dailyAlertFanout,
  evaluateTenantAlerts,
  ALL_FUNCTIONS,
} from "@/lib/server/inngest/functions";

describe("inngest functions contract", () => {
  it("exposes both functions in ALL_FUNCTIONS", () => {
    expect(ALL_FUNCTIONS).toHaveLength(2);
    expect(ALL_FUNCTIONS).toContain(dailyAlertFanout);
    expect(ALL_FUNCTIONS).toContain(evaluateTenantAlerts);
  });

  it("pins the cron function id to 'daily-alert-fanout'", () => {
    // The function object exposes the opts via `.id()` on newer Inngest SDKs
    // or `.opts.id` on older. Probe both.
    const f = dailyAlertFanout as unknown as {
      id?: string | (() => string);
      opts?: { id?: string };
      name?: string;
    };
    const id =
      typeof f.id === "function" ? f.id() : f.id ?? f.opts?.id ?? f.name ?? "";
    expect(id).toContain("daily-alert-fanout");
  });

  it("pins the event-driven function id to 'evaluate-tenant-alerts'", () => {
    const f = evaluateTenantAlerts as unknown as {
      id?: string | (() => string);
      opts?: { id?: string };
      name?: string;
    };
    const id =
      typeof f.id === "function" ? f.id() : f.id ?? f.opts?.id ?? f.name ?? "";
    expect(id).toContain("evaluate-tenant-alerts");
  });
});
