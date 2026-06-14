export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { TaskBoard } from "@/components/admin/TaskBoard";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import { PageHeader } from "@/components/ds";
import { redirect } from "next/navigation";
import {
  TASK_CURSOR_ORDER_BY,
  decodeTaskCursor,
  encodeTaskCursor,
  tupleGtWhere,
} from "@/lib/tasks/cursor";
import AdminPage from "@/app/_components/AdminPage";

// SSR page size. Matches /api/tasks?limit= default. Phase K's recurrence
// engine materialises TaskOccurrence rows daily, so the Task table grows
// unboundedly — without `take:` the entire list would be serialised into
// every admin/tasks page response. 50 keeps the initial HTML bounded and
// the matching /api/tasks endpoint streams subsequent pages.
const PAGE_SIZE = 50;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const { farmSlug } = await params;
  const { cursor } = (searchParams ? await searchParams : {}) ?? {};

  const session = await getSession();
  if (!session) redirect(`/${farmSlug}/login`);

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Tasks & Work Board" farmSlug={farmSlug} />;
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <AdminPage>
        <p className="text-sm text-[var(--ft-crit)]">Farm not found.</p>
      </AdminPage>
    );
  }

  // Decode the incoming cursor (if any) into a tuple-gt WHERE clause so we
  // only fetch rows strictly after the prior page boundary.
  const decodedCursor = cursor ? decodeTaskCursor(cursor) : null;
  const cursorWhere = decodedCursor ? tupleGtWhere(decodedCursor) : {};

  const mode = await getFarmMode(farmSlug);

  // Fetch PAGE_SIZE + 1 rows so we can cheaply detect "more available"
  // without a second COUNT round-trip.
  const [taskRows, camps] = await Promise.all([
    prisma.task.findMany({
      where: cursorWhere,
      orderBy: TASK_CURSOR_ORDER_BY,
      take: PAGE_SIZE + 1,
    }),
    // audit-allow-findmany: camp list is per-tenant and bounded (~40 camps);
    // needed for the create-task form dropdown.
    scoped(prisma, mode).camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const hasMore = taskRows.length > PAGE_SIZE;
  const pageTasks = hasMore ? taskRows.slice(0, PAGE_SIZE) : taskRows;
  const lastRow = pageTasks[pageTasks.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeTaskCursor({
          dueDate: lastRow.dueDate,
          createdAt: lastRow.createdAt.toISOString(),
          id: lastRow.id,
        })
      : null;

  const campList = camps.map((c) => ({
    camp_id: c.campId,
    camp_name: c.campName,
  }));

  return (
    <AdminPage>
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Tasks"
        subtitle={`task board · showing first ${pageTasks.length.toLocaleString()} task${pageTasks.length !== 1 ? "s" : ""}${hasMore ? " · scroll or Load more to see the rest" : ""}`}
      />

      <TaskBoard
        initialTasks={pageTasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
        camps={campList}
        nextCursor={nextCursor}
        hasMore={hasMore}
      />
    </AdminPage>
  );
}
