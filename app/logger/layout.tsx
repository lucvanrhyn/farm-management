'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { OfflineProvider } from '@/components/logger/OfflineProvider';

function SWRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}

export default function LoggerLayout({ children }: { children: React.ReactNode }) {
  return (
    <OfflineProvider>
      <SWRegistrar />
      {/* Fixed blurred farm background */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <Image
          src="/brangus.jpg"
          alt=""
          fill
          priority
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
