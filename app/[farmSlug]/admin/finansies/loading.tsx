export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-40 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded animate-pulse" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-24 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-xl animate-pulse"
          />
        ))}
      </div>

      {/* Table */}
      <div className="space-y-2">
        <div className="h-6 w-32 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded animate-pulse" />
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-12 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
