import CampSelector from "@/components/logger/CampSelector";
import { LoggerStatusBar } from "@/components/logger/LoggerStatusBar";
import { SignOutButton } from "@/components/logger/SignOutButton";
import { TodaysTasks } from "@/components/logger/TodaysTasks";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";


function getTodayLabel(): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date())
}

export default async function LoggerPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const todayLabel = getTodayLabel();
  const session = await getSession();
  const loggerName = session?.user?.name ?? "Logger";

  const prisma = await getPrismaForFarm(farmSlug);
  const farmSettings = prisma ? await prisma.farmSettings.findFirst() : null;
  const farmName = farmSettings?.farmName ?? "FarmTrack";

  return (
    <div className="min-h-screen">
      {/* Header — white */}
      <div
        className="sticky top-0 z-10"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.97)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <h1
              className="text-2xl font-bold leading-tight"
              style={{ fontFamily: 'var(--font-display)', color: '#1A1510' }}
            >
              {farmName}
            </h1>
            <p className="text-xs" style={{ color: '#5C3D2E' }}>{loggerName} · Select a camp</p>
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton />
          </div>
        </div>

        {/* Date bar */}
        <div
          className="text-xs px-4 py-2 text-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.03)', color: 'rgba(92,61,46,0.7)' }}
        >
          {todayLabel}
        </div>

        {/* Offline status bar */}
        <LoggerStatusBar />
      </div>

      <TodaysTasks />

      <CampSelector />

      <div className="h-8" />
    </div>
  );
}
