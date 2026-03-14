'use client';

import Image from 'next/image';
import { OfflineProvider } from '@/components/logger/OfflineProvider';
import { useEffect, useRef } from 'react';
import { CAMPS } from '@/lib/dummy-data';

// SW registration removed from here — it now lives in components/SWRegistrar.tsx
// which is rendered at root layout level (app/layout.tsx), ensuring the service
// worker activates on any page visit, not only when /logger is first opened.

export default function LoggerLayout({ children }: { children: React.ReactNode }) {
  const warmedUp = useRef(false);

  useEffect(() => {
    // Pre-fetch all camp pages into the SW "pages" cache while online so they
    // load instantly offline — no manual prep required by the user.
    // The SW's /logger/ URL-pattern rule intercepts these same-origin fetches
    // and stores the responses so the navigate handler can serve them offline.
    if (warmedUp.current || !navigator.onLine) return;
    warmedUp.current = true;
    CAMPS.forEach((camp) => {
      fetch(`/logger/${encodeURIComponent(camp.camp_id)}`, {
        credentials: "same-origin",
      }).catch(() => {});
    });
  }, []);

  return (
    <OfflineProvider>
      {/* Fixed blurred farm background */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/brangus.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover scale-105"
          style={{ filter: 'blur(5px)' }}
        />
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(26, 13, 5, 0.45)' }} suppressHydrationWarning />
      </div>
      {/* Scrollable content layer */}
      <div className="relative z-10">
        {children}
      </div>
    </OfflineProvider>
  );
}
