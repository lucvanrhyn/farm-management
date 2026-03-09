import CampSelector from "@/components/logger/CampSelector";
import { LoggerStatusBar } from "@/components/logger/LoggerStatusBar";
import { SignOutButton } from "@/components/logger/SignOutButton";
import { getSession } from "@/lib/auth";

const DAYS_AF    = ["Sondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrydag","Saterdag"];
const MONTHS_AF  = ["Januarie","Februarie","Maart","April","Mei","Junie","Julie","Augustus","September","Oktober","November","Desember"];

function getTodayAF(): string {
  const now = new Date();
  return `${DAYS_AF[now.getDay()]}, ${now.getDate()} ${MONTHS_AF[now.getMonth()]} ${now.getFullYear()}`;
}

export default async function LoggerPage() {
  const todayLabel = getTodayAF();
  const session = await getSession();
  const loggerName = session?.user?.name ?? "Logger";

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
              Trio B
            </h1>
            <p className="text-xs" style={{ color: '#5C3D2E' }}>{loggerName} · Kies &apos;n kamp</p>
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

      <CampSelector />

      <div className="h-8" />
    </div>
  );
}
