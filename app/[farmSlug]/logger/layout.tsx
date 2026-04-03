'use client';

import Image from 'next/image';
import { useParams } from 'next/navigation';
import { OfflineProvider } from '@/components/logger/OfflineProvider';
import { useEffect, useRef, useState } from 'react';
import type { Camp } from '@/lib/types';

export default function LoggerLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const farmSlug = params.farmSlug as string;
  const warmedUp = useRef(false);
  const [heroImage, setHeroImage] = useState("/farm-hero.jpg");

  useEffect(() => {
    fetch("/api/farm")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.heroImageUrl && typeof data.heroImageUrl === "string" && data.heroImageUrl.startsWith("/")) {
          setHeroImage(data.heroImageUrl);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Pre-fetch all camp pages into the SW "pages" cache while online so they
    // load instantly offline — no manual prep required by the user.
    if (warmedUp.current || !navigator.onLine) return;
    warmedUp.current = true;
    fetch("/api/camps")
      .then((r) => r.ok ? r.json() : [])
      .then((camps: Camp[]) => {
        camps.forEach((camp) => {
          fetch(`/${farmSlug}/logger/${encodeURIComponent(camp.camp_id)}`, {
            credentials: "same-origin",
          }).catch(() => {});
        });
      })
      .catch(() => {});
  }, [farmSlug]);

  return (
    <OfflineProvider>
      {/* Fixed blurred farm background */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <Image
          src={heroImage}
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
