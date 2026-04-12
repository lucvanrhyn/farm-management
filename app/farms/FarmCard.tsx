'use client';

import { motion } from 'framer-motion';
import type { SessionFarm } from '@/types/next-auth';
import type { FarmOverview } from '@/lib/server/multi-farm-overview';
import { FarmOverviewStats } from '@/components/farms/FarmOverviewStats';

interface FarmCardProps {
  farm: SessionFarm;
  index: number;
  overview?: FarmOverview;
}

export function FarmCard({ farm, index, overview }: FarmCardProps) {
  return (
    <motion.a
      href={`/api/farms/${farm.slug}/select`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 24, delay: index * 0.07 }}
      whileHover={{ scale: 1.015, transition: { type: 'spring', stiffness: 300, damping: 20 } }}
      whileTap={{ scale: 0.98 }}
      className="group flex items-center justify-between px-6 py-5"
      style={{
        borderRadius: '2rem',
        background: '#241C14',
        border: '1px solid rgba(196,144,48,0.18)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.40)',
        textDecoration: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.border = '1px solid rgba(196,144,48,0.40)';
        el.style.boxShadow = '0 0 32px rgba(196,144,48,0.08), 0 8px 32px rgba(0,0,0,0.55)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.border = '1px solid rgba(196,144,48,0.18)';
        el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.40)';
      }}
    >
      <div className="flex flex-col gap-1">
        <span
          style={{
            fontFamily: 'var(--font-display)',
            color: '#F0DEB8',
            fontSize: '1.0625rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          {farm.displayName}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            color: '#6A4E30',
            fontSize: '0.7rem',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
          }}
        >
          {farm.role}
        </span>
        {overview && <FarmOverviewStats overview={overview} />}
      </div>

      <svg
        className="w-4 h-4 opacity-40 group-hover:opacity-100 transition-opacity duration-200"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        style={{ color: '#C49030', flexShrink: 0 }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    </motion.a>
  );
}
