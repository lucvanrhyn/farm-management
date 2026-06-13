/**
 * @vitest-environment node
 *
 * S30 (auth-M1) + pay-M2 (proxy half) — billing-gate disposition.
 *
 * proxy.ts gates paid-tier farms whose subscription has lapsed, redirecting
 * them to /subscribe. The decision is extracted into the pure, exported
 * `shouldGateForBilling()` helper so its full truth-table can be asserted
 * without booting the Edge runtime (same pattern as `isProtectedPath`).
 *
 * Two findings drive this test:
 *
 *   auth-M1 (fail-closed billing in prod): the original gate only fired when
 *   `PAYFAST_MERCHANT_ID` was set — so an unset env var in prod silently
 *   disabled ALL Basic billing enforcement (fail-OPEN). The bypass for an
 *   unconfigured PayFast must apply ONLY in non-production (dev/staging
 *   convenience); production enforces regardless of the env var.
 *
 *   pay-M2 (broaden beyond basic): the gate only fired for `tier === "basic"`,
 *   so a lapsed Advanced subscription kept full access. The gate now fires for
 *   any self-serve PAID tier (basic + advanced). Consulting is bespoke /
 *   manually provisioned and budget-exempt — it must NEVER be gated.
 */

import { describe, it, expect } from "vitest";
import { shouldGateForBilling } from "@/proxy";

describe("shouldGateForBilling — auth-M1 prod fail-closed", () => {
  it("PROD + PayFast unset + Basic + lapsed → GATED (fail-closed)", () => {
    expect(
      shouldGateForBilling({
        tier: "basic",
        subscriptionStatus: "inactive",
        payfastConfigured: false,
        isProduction: true,
      }),
    ).toBe(true);
  });

  it("DEV + PayFast unset + Basic + lapsed → NOT gated (dev convenience bypass)", () => {
    expect(
      shouldGateForBilling({
        tier: "basic",
        subscriptionStatus: "inactive",
        payfastConfigured: false,
        isProduction: false,
      }),
    ).toBe(false);
  });

  it("PROD + PayFast SET + Basic + lapsed → GATED (unchanged historical behaviour)", () => {
    expect(
      shouldGateForBilling({
        tier: "basic",
        subscriptionStatus: "inactive",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(true);
  });

  it("DEV + PayFast SET + Basic + lapsed → GATED (env present forces enforcement even in dev)", () => {
    expect(
      shouldGateForBilling({
        tier: "basic",
        subscriptionStatus: "inactive",
        payfastConfigured: true,
        isProduction: false,
      }),
    ).toBe(true);
  });
});

describe("shouldGateForBilling — pay-M2 broaden beyond basic", () => {
  it("PROD + Advanced + lapsed → GATED (was previously NOT gated — the bug)", () => {
    expect(
      shouldGateForBilling({
        tier: "advanced",
        subscriptionStatus: "inactive",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(true);
  });

  it("PROD + Advanced + lapsed + PayFast unset → GATED (fail-closed applies to advanced too)", () => {
    expect(
      shouldGateForBilling({
        tier: "advanced",
        subscriptionStatus: "inactive",
        payfastConfigured: false,
        isProduction: true,
      }),
    ).toBe(true);
  });

  it("DEV + Advanced + lapsed + PayFast unset → NOT gated (dev convenience)", () => {
    expect(
      shouldGateForBilling({
        tier: "advanced",
        subscriptionStatus: "inactive",
        payfastConfigured: false,
        isProduction: false,
      }),
    ).toBe(false);
  });
});

describe("shouldGateForBilling — never gate active or exempt farms", () => {
  it("Basic + ACTIVE → NOT gated", () => {
    expect(
      shouldGateForBilling({
        tier: "basic",
        subscriptionStatus: "active",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it("Advanced + ACTIVE → NOT gated", () => {
    expect(
      shouldGateForBilling({
        tier: "advanced",
        subscriptionStatus: "active",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it("Consulting + lapsed + PROD + PayFast set → NOT gated (bespoke / budget-exempt)", () => {
    expect(
      shouldGateForBilling({
        tier: "consulting",
        subscriptionStatus: "inactive",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it("Consulting + lapsed + PROD + PayFast unset → NOT gated", () => {
    expect(
      shouldGateForBilling({
        tier: "consulting",
        subscriptionStatus: "inactive",
        payfastConfigured: false,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it("unknown tier + lapsed → NOT gated (only the two self-serve paid tiers are gated)", () => {
    expect(
      shouldGateForBilling({
        tier: "freebie",
        subscriptionStatus: "inactive",
        payfastConfigured: true,
        isProduction: true,
      }),
    ).toBe(false);
  });
});
