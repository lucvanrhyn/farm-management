export const dynamic = "force-dynamic";
/**
 * Phase K Wave 3F — /admin/settings/tasks
 *
 * Server shell. Fetches installed TaskTemplates + current task-settings JSON
 * blob and hands them to a client component that renders:
 *   • "Templates" tab — table of installed templates + install/edit/delete
 *   • "Defaults" tab  — reminder offset / auto-obs toggle / horizon dropdown
 *
 * Admin layout above already enforces ADMIN role so this page just fetches.
 */

import { requireSession, requireFarmAdmin } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import TaskSettingsClient, {
  type TaskTemplateRow,
} from "@/components/admin/tasks/TaskSettingsClient";
import { DEFAULT_TASK_SETTINGS, type FarmTaskSettings } from "@/lib/farm-settings/defaults";


function parseTaskSettings(raw: string | null | undefined): FarmTaskSettings {
  if (!raw) return DEFAULT_TASK_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmTaskSettings>;
    return {
      defaultReminderOffset:
        typeof parsed.defaultReminderOffset === "number" && parsed.defaultReminderOffset >= 0
          ? Math.round(parsed.defaultReminderOffset)
          : DEFAULT_TASK_SETTINGS.defaultReminderOffset,
      autoObservation:
        typeof parsed.autoObservation === "boolean"
          ? parsed.autoObservation
          : DEFAULT_TASK_SETTINGS.autoObservation,
      horizonDays:
        parsed.horizonDays === 30 || parsed.horizonDays === 60 || parsed.horizonDays === 90
          ? parsed.horizonDays
          : DEFAULT_TASK_SETTINGS.horizonDays,
    };
  } catch {
    return DEFAULT_TASK_SETTINGS;
  }
}

export default async function TasksSettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await requireSession(`/${farmSlug}/admin/settings/tasks`);
  await requireFarmAdmin(session, farmSlug);

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="p-8 bg-[var(--ft-bg)] min-h-screen">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const [rawTemplates, rawSettings] = await Promise.all([
    prisma.taskTemplate.findMany({
      where: { tenantSlug: farmSlug },
      orderBy: [{ taskType: "asc" }, { name: "asc" }],
    }),
    prisma.farmSettings.findFirst({ select: { taskSettings: true } }),
  ]);

  const templates: TaskTemplateRow[] = rawTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    name_af: t.name_af,
    taskType: t.taskType,
    description: t.description,
    description_af: t.description_af,
    priorityDefault: t.priorityDefault,
    recurrenceRule: t.recurrenceRule,
    reminderOffset: t.reminderOffset,
    species: t.species,
    isPublic: t.isPublic,
  }));

  const settings = parseTaskSettings(rawSettings?.taskSettings);

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--ft-text)" }}>
          Task Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--ft-subtle)" }}>
          Templates, reminder defaults, and auto-observation behaviour
        </p>
      </div>

      <div className="max-w-4xl">
        <TaskSettingsClient
          farmSlug={farmSlug}
          initialTemplates={templates}
          initialSettings={settings}
        />
      </div>
    </div>
  );
}
