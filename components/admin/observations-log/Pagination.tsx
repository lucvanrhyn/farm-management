// components/admin/observations-log/Pagination.tsx
// Simple Previous / Next pagination strip below the timeline.

"use client";

interface PaginationProps {
  page: number;
  hasMore: boolean;
  loading: boolean;
  onPageChange: (next: number) => void;
}

export function Pagination({ page, hasMore, loading, onPageChange }: PaginationProps) {
  return (
    <div className="flex items-center gap-2 justify-center">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1 || loading}
        className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
        style={{
          border: "1px solid var(--ft-border)",
          color: "var(--ft-muted)",
          background: "transparent",
        }}
      >
        ← Previous
      </button>
      <span className="text-sm font-mono" style={{ color: "var(--ft-subtle)" }}>Page {page}</span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasMore || loading}
        className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
        style={{
          border: "1px solid var(--ft-border)",
          color: "var(--ft-muted)",
          background: "transparent",
        }}
      >
        Next →
      </button>
    </div>
  );
}
