'use client';

import type { SessionFarm } from '@/types/next-auth';

export function FarmCard({ farm }: { farm: SessionFarm }) {
  return (
    <a
      href={`/api/farms/${farm.slug}/select`}
      className="group flex items-center justify-between rounded-2xl px-6 py-5 transition-all duration-200"
      style={{
        background: 'rgba(5,3,1,0.58)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.40)',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = 'rgba(12,7,2,0.70)';
        el.style.border = '1px solid rgba(196,144,48,0.30)';
        el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(196,144,48,0.15)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = 'rgba(5,3,1,0.58)';
        el.style.border = '1px solid rgba(255,255,255,0.07)';
        el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.40)';
      }}
    >
      <div className="flex flex-col gap-0.5">
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
            color: '#7A5840',
            fontSize: '0.7rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {farm.role}
        </span>
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
    </a>
  );
}
