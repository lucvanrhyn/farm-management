export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-40 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded animate-pulse" />

      {/* Filter bar */}
      <div className="flex gap-3">
        <div className="h-10 w-48 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
        <div className="h-10 w-32 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
        <div className="h-10 w-32 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
      </div>

      {/* Table rows */}
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="h-12 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
