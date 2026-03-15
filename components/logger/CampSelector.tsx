"use client";

import { useRouter } from "next/navigation";
import { useOffline } from "./OfflineProvider";
import { getGrazingDot, relativeTime } from "@/lib/utils";
import { GlowingEffect } from "@/components/ui/glowing-effect";

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
  const { camps } = useOffline();

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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
      {camps.map((camp, index) => {
        const animalCount = camp.animal_count ?? 0;
        const dotColor = getGrazingDot(camp.grazing_quality ?? "Fair");
        const lastTime = camp.last_inspected_at ? relativeTime(camp.last_inspected_at) : "Nog nie";

        return (
          <button
            key={camp.camp_id}
            onClick={() => router.push(`/logger/${encodeURIComponent(camp.camp_id)}`)}
            className="relative rounded-2xl p-4 text-left active:scale-95 transition-transform animate-fade-up flex flex-col gap-2 min-h-[96px]"
            style={{
              backgroundColor: 'rgba(250, 240, 220, 0.18)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(210, 180, 140, 0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,248,235,0.15)',
              animationDelay: `${index * 55}ms`,
            }}
          >
            <GlowingEffect
              variant="white"
              disabled={false}
              glow={true}
              spread={40}
              proximity={64}
              inactiveZone={0.01}
              borderWidth={2}
            />
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
                {animalCount} diere
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
