/**
 * Phase J7a — Alert settings page.
 *
 * Server shell: fetches the caller's AlertPreferences + tenant FarmSettings
 * directly via Prisma, then hands them to the `AlertSettingsForm` client
 * component for optimistic editing. The admin layout above us has already
 * gated this route on ADMIN role, so every user reaching this file is an
 * admin. We still pass `isAdmin={true}` explicitly — keeps the client
 * component contract usable from other placements if we ever move it.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getUserRoleForFarm } from "@/lib/auth";
import AlertSettingsForm, {
  type AlertPreferenceRow,
  type FarmAlertSettings,
} from "@/components/admin/AlertSettingsForm";
import { redirect } from "next/navigation";


export default async function AlertsSettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const role = getUserRoleForFarm(session, farmSlug);
  // Layout already enforces ADMIN but we double-check so a direct render
  // outside the layout (tests, future embeds) still behaves correctly.
  const isAdmin = role === "ADMIN";

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="p-8 bg-[#FAFAF8] min-h-screen">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const [rawPrefs, rawSettings] = await Promise.all([
    prisma.alertPreference.findMany({
      where: { userId: session.user.id },
      orderBy: [{ category: "asc" }, { channel: "asc" }],
    }),
    prisma.farmSettings.findFirst({
      select: {
        quietHoursStart: true,
        quietHoursEnd: true,
        timezone: true,
        speciesAlertThresholds: true,
      },
    }),
  ]);

  const prefs: AlertPreferenceRow[] = rawPrefs.map((p) => ({
    id: p.id,
    userId: p.userId,
    category: p.category as AlertPreferenceRow["category"],
    alertType: p.alertType,
    channel: p.channel as AlertPreferenceRow["channel"],
    enabled: p.enabled,
    digestMode: p.digestMode as AlertPreferenceRow["digestMode"],
    speciesOverride: p.speciesOverride as AlertPreferenceRow["speciesOverride"],
  }));

  const farmSettings: FarmAlertSettings = {
    quietHoursStart: rawSettings?.quietHoursStart ?? "20:00",
    quietHoursEnd: rawSettings?.quietHoursEnd ?? "06:00",
    timezone: rawSettings?.timezone ?? "Africa/Johannesburg",
    speciesAlertThresholds: rawSettings?.speciesAlertThresholds ?? null,
  };

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Alert Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Channels, quiet hours, digest frequency, and per-species overrides
        </p>
      </div>

      <div className="max-w-4xl">
        <AlertSettingsForm
          farmSlug={farmSlug}
          isAdmin={isAdmin}
          initialPrefs={prefs}
          initialFarmSettings={farmSettings}
        />
      </div>
    </div>
  );
}
