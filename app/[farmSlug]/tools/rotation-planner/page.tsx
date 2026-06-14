export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { PageHeader } from "@/components/ds";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import RotationPlannerClient from "@/components/rotation/RotationPlannerClient";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import type { RotationPlan } from "@/components/rotation/types";


export default async function RotationPlannerPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  await requireSession(`/${farmSlug}/tools/rotation-planner`);

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Rotation Planner" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) redirect("/login");

  const mode = await getFarmMode(farmSlug);

  const [rawPlans, rotationPayload, camps, mobs] = await Promise.all([
    prisma.rotationPlan.findMany({
      include: { steps: { orderBy: { sequence: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    getRotationStatusByCamp(prisma),
    scoped(prisma, mode).camp.findMany({ orderBy: { campName: "asc" } }),
    scoped(prisma, mode).mob.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Serialize Prisma Date objects to ISO strings for client components
  const plans: RotationPlan[] = rawPlans.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status as RotationPlan["status"],
    notes: p.notes,
    startDate: p.startDate.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    steps: p.steps.map((s) => ({
      id: s.id,
      planId: s.planId,
      sequence: s.sequence,
      campId: s.campId,
      mobId: s.mobId,
      plannedStart: s.plannedStart.toISOString(),
      plannedDays: s.plannedDays,
      status: s.status as RotationPlan["steps"][number]["status"],
      actualStart: s.actualStart?.toISOString() ?? null,
      actualEnd: s.actualEnd?.toISOString() ?? null,
      executedObservationId: s.executedObservationId,
      notes: s.notes,
    })),
  }));

  const rotationByCampId = Object.fromEntries(
    rotationPayload.camps.map((c) => [
      c.campId,
      {
        status: c.status,
        effectiveMaxGrazingDays: c.effectiveMaxGrazingDays,
        effectiveRestDays: c.effectiveRestDays,
      },
    ]),
  );

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Rotation Planner"
        subtitle="rotation planner"
      />
      <RotationPlannerClient
        farmSlug={farmSlug}
        plans={plans}
        rotationByCampId={rotationByCampId}
        camps={camps.map((c) => ({
          id: c.id,
          campId: c.campId,
          campName: c.campName,
          sizeHectares: c.sizeHectares,
        }))}
        mobs={mobs.map((m) => ({ id: m.id, name: m.name, currentCamp: m.currentCamp }))}
      />
    </div>
  );
}
