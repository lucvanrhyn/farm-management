"use client";

import { useRouter, useParams } from "next/navigation";
import { useOffline } from "./OfflineProvider";
import { getGrazingDot, relativeTime } from "@/lib/utils";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { ModeSwitcher } from "@/components/ui/ModeSwitcher";

// CampSelector sits on the logger's critical path. Previously it imported
// framer-motion (~90KB gzipped) for a stagger-in entrance + tap-scale
// feedback. The stagger actually *delays* the moment the user can tap
// their target camp, so dropping it is both a perf win and a UX win. Tap
// feedback is now `active:scale-95` via Tailwind — pure CSS, zero JS.

function CampSkeleton() {
  return (
    <div
      className="relative rounded-2xl p-4 flex flex-col gap-2 min-h-[96px] animate-pulse"
      style={{
        backgroundColor: 'rgba(250, 240, 220, 0.08)',
        border: '1px solid rgba(210, 180, 140, 0.2)',
      }}
    >
      <div className="h-4 w-3/4 rounded-md" style={{ backgroundColor: 'rgba(255,248,235,0.12)' }} />
      <div className="h-3 w-1/2 rounded-md" style={{ backgroundColor: 'rgba(255,248,235,0.08)' }} />
      <div className="h-5 w-1/3 rounded-full mt-auto" style={{ backgroundColor: 'rgba(255,248,235,0.08)' }} />
    </div>
  );
}

export default function CampSelector() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const { camps } = useOffline();
  const { isMultiMode } = useFarmModeSafe();

  if (camps.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <CampSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Mode switcher for logger — only shown when multi-species */}
      {isMultiMode && (
        <div className="flex justify-center pt-3 pb-1">
          <ModeSwitcher variant="glass" />
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
      {camps.map((camp) => {
        const animalCount = camp.animal_count ?? 0;
        // Use grey dot when no condition has ever been recorded; do not default to "Fair"
        const dotColor = camp.grazing_quality ? getGrazingDot(camp.grazing_quality) : "bg-gray-500";
        const lastTime = camp.last_inspected_at ? relativeTime(camp.last_inspected_at) : "Never";

        return (
          <button
            key={camp.camp_id}
            onClick={() => router.push(`/${params.farmSlug}/logger/${encodeURIComponent(camp.camp_id)}`)}
            className="relative rounded-2xl p-4 text-left flex flex-col gap-2 min-h-[96px] transition-transform duration-150 ease-out active:scale-95"
            style={{
              backgroundColor: 'rgba(250, 240, 220, 0.18)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(210, 180, 140, 0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,248,235,0.15)',
            }}
          >
            {/* Grazing status dot */}
            <div className={`absolute top-3 right-3 w-3 h-3 rounded-full ${dotColor}`} />

            <div>
              <p
                className="font-bold text-base leading-tight pr-5"
                style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
              >
                {camp.camp_name}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(245, 230, 200, 0.75)' }}>
                {lastTime}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'rgba(255, 248, 235, 0.15)',
                  color: 'rgba(245, 230, 200, 0.9)',
                  border: '1px solid rgba(210, 180, 140, 0.35)',
                }}
              >
                {animalCount} animals
              </span>
            </div>
          </button>
        );
      })}
    </div>
    </div>
  );
}
