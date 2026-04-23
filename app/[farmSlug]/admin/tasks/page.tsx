
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { TaskBoard } from "@/components/admin/TaskBoard";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { redirect } from "next/navigation";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await getSession();
  if (!session) redirect(`/${farmSlug}/login`);

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Tasks & Work Board" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <p className="text-sm text-red-600">Farm not found.</p>
      </div>
    );
  }

  const [tasks, camps] = await Promise.all([
    prisma.task.findMany({
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const campList = camps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1C1815]">Tasks</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {tasks.length} task{tasks.length !== 1 ? "s" : ""} total
        </p>
      </div>

      <TaskBoard
        initialTasks={tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
        camps={campList}
      />
    </div>
  );
}
