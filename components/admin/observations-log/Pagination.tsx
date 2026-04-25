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
          border: "1px solid #E0D5C8",
          color: "#6B5C4E",
          background: "transparent",
        }}
      >
        ← Previous
      </button>
      <span className="text-sm font-mono" style={{ color: "#9C8E7A" }}>Page {page}</span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasMore || loading}
        className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
        style={{
          border: "1px solid #E0D5C8",
          color: "#6B5C4E",
          background: "transparent",
        }}
      >
        Next →
      </button>
    </div>
  );
}
