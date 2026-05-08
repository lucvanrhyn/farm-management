/**
 * Phase J7b — Alert preferences API.
 *
 * GET  → returns the caller's AlertPreference rows + the tenant-wide
 *        quietHours/timezone so the UI can render a single form.
 * PATCH → split gate:
 *          - Writing user-scoped prefs (`prefs[]`)      ⇒ any authenticated user
 *            who belongs to this farm may edit THEIR OWN rows.
 *          - Writing tenant-wide fields (quietHoursStart,
 *            quietHoursEnd, timezone, speciesAlertThresholds)
 *                                                       ⇒ requires ADMIN role
 *            verified against the meta DB (not the JWT) so a revoked admin
 *            can't mutate farm-wide notification policy during the JWT TTL
 *            window (see lib/auth.ts::verifyFreshAdminRole).
 *
 * Wave G5 (#169) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G5 spec):
 *   - 200 success shape unchanged ({ success, prefs, farmSettings }).
 *   - 401 envelope migrates from the route-minted
 *     `{ success: false, error: "AUTH_REQUIRED", message }` to the adapter's
 *     canonical `{ error: "AUTH_REQUIRED", message }` — `body.error` keeps the
 *     same SCREAMING_SNAKE code that existing test/clients key on. The
 *     legacy 403 `FARM_ACCESS_DENIED` collapses into the adapter's 401
 *     `AUTH_REQUIRED` (same `getFarmContextForSlug` null path the adapter
 *     already centralises).
 *   - 400 INVALID_BODY on malformed JSON now flows through the adapter
 *     (same envelope shape, same code).
 *   - Bespoke validation/auth codes (INVALID_PREF_FIELD,
 *     INVALID_QUIET_HOURS, INVALID_TIMEZONE,
 *     ADMIN_REQUIRED_FOR_FARM_SETTINGS) keep their existing
 *     `{ success: false, error, message }` shape — these are bespoke handler
 *     concerns. The split-gate `verifyFreshAdminRole` check stays inline.
 *
 * Error codes are specific (per memory/silent-failure-pattern.md):
 *   AUTH_REQUIRED                 — 401, no session (adapter)
 *   ADMIN_REQUIRED_FOR_FARM_SETTINGS — 403, non-admin tried to write quiet-hours/tz/thresholds
 *   INVALID_BODY                  — 400, non-JSON or wrong shape
 *   INVALID_PREF_FIELD            — 400, a pref row failed validation
 *   INVALID_QUIET_HOURS           — 400, HH:mm format broken
 *   INVALID_TIMEZONE              — 400, empty / non-string tz
 */

import { NextResponse } from "next/server";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

// Constants mirrored in the UI (components/admin/AlertSettingsForm.tsx) so
// client and server agree on the shape of the matrix. If you add a category
// here, add it to ALERT_CATEGORIES in the client component too.
const ALERT_CATEGORIES = [
  "reproduction",
  "performance",
  "veld",
  "finance",
  "compliance",
  "weather",
  "predator",
] as const;
type AlertCategory = (typeof ALERT_CATEGORIES)[number];
const ALERT_CATEGORY_SET: ReadonlySet<string> = new Set(ALERT_CATEGORIES);

const ALERT_CHANNELS = ["bell", "email", "push", "whatsapp"] as const;
type AlertChannel = (typeof ALERT_CHANNELS)[number];
const ALERT_CHANNEL_SET: ReadonlySet<string> = new Set(ALERT_CHANNELS);

const DIGEST_MODES = ["realtime", "daily", "weekly"] as const;
type DigestMode = (typeof DIGEST_MODES)[number];
const DIGEST_MODE_SET: ReadonlySet<string> = new Set(DIGEST_MODES);

const SPECIES_OVERRIDES = ["cattle", "sheep", "game"] as const;
const SPECIES_OVERRIDE_SET: ReadonlySet<string> = new Set(SPECIES_OVERRIDES);

// HH:mm with 24-hour clock. "25:00" or "09:5" fail.
const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface PrefInput {
  category: AlertCategory;
  alertType: string | null;
  channel: AlertChannel;
  enabled: boolean;
  digestMode: DigestMode;
  speciesOverride: string | null;
}

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

function validatePref(raw: unknown, idx: number): PrefInput | string {
  if (!raw || typeof raw !== "object") {
    return `prefs[${idx}] must be an object`;
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.category !== "string" || !ALERT_CATEGORY_SET.has(r.category)) {
    return `prefs[${idx}].category invalid`;
  }
  if (typeof r.channel !== "string" || !ALERT_CHANNEL_SET.has(r.channel)) {
    return `prefs[${idx}].channel invalid`;
  }
  if (typeof r.enabled !== "boolean") {
    return `prefs[${idx}].enabled must be a boolean`;
  }
  if (typeof r.digestMode !== "string" || !DIGEST_MODE_SET.has(r.digestMode)) {
    return `prefs[${idx}].digestMode invalid`;
  }

  // alertType: optional — either a non-empty string or null/undefined (→ null).
  let alertType: string | null = null;
  if (r.alertType !== undefined && r.alertType !== null) {
    if (typeof r.alertType !== "string" || !r.alertType.trim()) {
      return `prefs[${idx}].alertType must be a non-empty string or null`;
    }
    alertType = r.alertType.trim();
  }

  // speciesOverride: optional — null means applies to all species.
  let speciesOverride: string | null = null;
  if (r.speciesOverride !== undefined && r.speciesOverride !== null) {
    if (
      typeof r.speciesOverride !== "string" ||
      !SPECIES_OVERRIDE_SET.has(r.speciesOverride)
    ) {
      return `prefs[${idx}].speciesOverride must be one of cattle/sheep/game or null`;
    }
    speciesOverride = r.speciesOverride;
  }

  // Safety floor: PREDATOR alerts are always real-time. Reject attempts to
  // flip them to digest mode — the UI greys this out, this is defence-in-depth
  // for direct API callers (mobile app, curl).
  if (r.category === "predator" && r.digestMode !== "realtime") {
    return `prefs[${idx}]: predator alerts must stay realtime`;
  }

  return {
    category: r.category as AlertCategory,
    alertType,
    channel: r.channel as AlertChannel,
    enabled: r.enabled,
    digestMode: r.digestMode as DigestMode,
    speciesOverride,
  };
}

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const [prefs, settings] = await Promise.all([
      ctx.prisma.alertPreference.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: [{ category: "asc" }, { channel: "asc" }],
      }),
      ctx.prisma.farmSettings.findFirst({
        select: {
          quietHoursStart: true,
          quietHoursEnd: true,
          timezone: true,
          speciesAlertThresholds: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      prefs,
      farmSettings: {
        quietHoursStart: settings?.quietHoursStart ?? "20:00",
        quietHoursEnd: settings?.quietHoursEnd ?? "06:00",
        timezone: settings?.timezone ?? "Africa/Johannesburg",
        speciesAlertThresholds: settings?.speciesAlertThresholds ?? null,
      },
    });
  },
});

export const PATCH = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateSettingsWrite,
  handle: async (ctx, parsedBody, _req, params) => {
    // Body has already been parsed as JSON by the adapter (malformed JSON
    // returns INVALID_BODY before this handler runs). We still need to verify
    // it's an object before we destructure it.
    if (!parsedBody || typeof parsedBody !== "object") {
      return asErr("INVALID_BODY", "Body must be valid JSON object", 400);
    }
    const body = parsedBody as Record<string, unknown>;

    const userId = ctx.session.user.id;

    // ── Validate prefs[] if present ────────────────────────────────────────
    let validatedPrefs: PrefInput[] | null = null;
    if ("prefs" in body) {
      if (!Array.isArray(body.prefs)) {
        return asErr("INVALID_BODY", "prefs must be an array", 400);
      }
      validatedPrefs = [];
      for (let i = 0; i < body.prefs.length; i += 1) {
        const result = validatePref(body.prefs[i], i);
        if (typeof result === "string") {
          return asErr("INVALID_PREF_FIELD", result, 400);
        }
        validatedPrefs.push(result);
      }
    }

    // ── Detect tenant-wide field writes (split-gate) ───────────────────────
    const farmLevelKeys = ["quietHoursStart", "quietHoursEnd", "timezone", "speciesAlertThresholds"] as const;
    const writesFarmFields = farmLevelKeys.some((k) => k in body);

    if (writesFarmFields) {
      // Phase H.2 / split-gate: any farm-level write requires a freshly-verified
      // ADMIN. This closes the 60s JWT TTL window where a revoked admin could
      // still mutate tenant-wide notification policy. User-prefs writes (the
      // `prefs[]` path) DO NOT need this gate — kept verbatim from pre-Wave G5.
      if (ctx.role !== "ADMIN") {
        return asErr(
          "ADMIN_REQUIRED_FOR_FARM_SETTINGS",
          "Only farm admins can change quiet hours, timezone or species thresholds",
          403,
        );
      }
      const fresh = await verifyFreshAdminRole(userId, params.farmSlug);
      if (!fresh) {
        return asErr(
          "ADMIN_REQUIRED_FOR_FARM_SETTINGS",
          "Admin access has been revoked — reload and sign in again",
          403,
        );
      }
    }

    // ── Validate quietHours / timezone shape ───────────────────────────────
    const farmUpdate: {
      quietHoursStart?: string;
      quietHoursEnd?: string;
      timezone?: string;
      speciesAlertThresholds?: string | null;
    } = {};

    if ("quietHoursStart" in body) {
      if (typeof body.quietHoursStart !== "string" || !HH_MM_RE.test(body.quietHoursStart)) {
        return asErr("INVALID_QUIET_HOURS", "quietHoursStart must be HH:mm", 400);
      }
      farmUpdate.quietHoursStart = body.quietHoursStart;
    }
    if ("quietHoursEnd" in body) {
      if (typeof body.quietHoursEnd !== "string" || !HH_MM_RE.test(body.quietHoursEnd)) {
        return asErr("INVALID_QUIET_HOURS", "quietHoursEnd must be HH:mm", 400);
      }
      farmUpdate.quietHoursEnd = body.quietHoursEnd;
    }
    if ("timezone" in body) {
      if (typeof body.timezone !== "string" || !body.timezone.trim()) {
        return asErr("INVALID_TIMEZONE", "timezone must be a non-empty string", 400);
      }
      // Validate with Intl — throws RangeError on unknown zones.
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        return asErr("INVALID_TIMEZONE", `timezone "${body.timezone}" is not a valid IANA zone`, 400);
      }
      farmUpdate.timezone = body.timezone.trim();
    }
    if ("speciesAlertThresholds" in body) {
      if (body.speciesAlertThresholds === null) {
        farmUpdate.speciesAlertThresholds = null;
      } else if (typeof body.speciesAlertThresholds === "string") {
        // Require valid JSON — prevents garbage from ever hitting consumers.
        try {
          JSON.parse(body.speciesAlertThresholds);
        } catch {
          return asErr(
            "INVALID_BODY",
            "speciesAlertThresholds must be a JSON string or null",
            400,
          );
        }
        farmUpdate.speciesAlertThresholds = body.speciesAlertThresholds;
      } else if (typeof body.speciesAlertThresholds === "object") {
        // Allow the client to send an object — we stringify on the way in.
        farmUpdate.speciesAlertThresholds = JSON.stringify(body.speciesAlertThresholds);
      } else {
        return asErr(
          "INVALID_BODY",
          "speciesAlertThresholds must be a JSON string, object, or null",
          400,
        );
      }
    }

    // ── Apply writes ───────────────────────────────────────────────────────
    if (validatedPrefs) {
      // Upsert by the model's composite unique key. Prisma's `upsert` maps to
      // INSERT … ON CONFLICT which is safe under concurrent callers.
      // Run sequentially rather than in a single transaction because Turso's
      // libSQL driver batches serverless calls efficiently, and sequential
      // upserts keep the error surface row-local.
      for (const p of validatedPrefs) {
        await ctx.prisma.alertPreference.upsert({
          where: {
            unique_user_pref: {
              userId,
              category: p.category,
              // Prisma represents the composite unique on nullable columns as
              // the full tuple — pass nulls literally.
              alertType: p.alertType as string,
              channel: p.channel,
              speciesOverride: p.speciesOverride as string,
            },
          },
          update: {
            enabled: p.enabled,
            digestMode: p.digestMode,
          },
          create: {
            userId,
            category: p.category,
            alertType: p.alertType,
            channel: p.channel,
            enabled: p.enabled,
            digestMode: p.digestMode,
            speciesOverride: p.speciesOverride,
          },
        });
      }
    }

    if (Object.keys(farmUpdate).length > 0) {
      // Upsert so brand-new tenants without a FarmSettings row still succeed.
      await ctx.prisma.farmSettings.upsert({
        where: { id: "singleton" },
        update: farmUpdate,
        create: {
          id: "singleton",
          farmName: "My Farm",
          breed: "Mixed",
          ...farmUpdate,
        },
      });
    }

    const [prefs, settings] = await Promise.all([
      ctx.prisma.alertPreference.findMany({
        where: { userId },
        orderBy: [{ category: "asc" }, { channel: "asc" }],
      }),
      ctx.prisma.farmSettings.findFirst({
        select: {
          quietHoursStart: true,
          quietHoursEnd: true,
          timezone: true,
          speciesAlertThresholds: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      prefs,
      farmSettings: {
        quietHoursStart: settings?.quietHoursStart ?? "20:00",
        quietHoursEnd: settings?.quietHoursEnd ?? "06:00",
        timezone: settings?.timezone ?? "Africa/Johannesburg",
        speciesAlertThresholds: settings?.speciesAlertThresholds ?? null,
      },
    });
  },
});
