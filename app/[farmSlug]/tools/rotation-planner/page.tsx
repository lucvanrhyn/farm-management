export const dynamic = "force-dynamic";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getFarmCreds } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import RotationPlannerClient from "@/components/rotation/RotationPlannerClient";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import type { RotationPlan } from "@/components/rotation/types";


export default async function RotationPlannerPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Rotation Planner" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) redirect("/login");

  const [rawPlans, rotationPayload, camps, mobs] = await Promise.all([
    prisma.rotationPlan.findMany({
      include: { steps: { orderBy: { sequence: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    getRotationStatusByCamp(prisma),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
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
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Rotation Planner
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Plan and execute pasture rotation sequences across your camps.
        </p>
      </div>
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
