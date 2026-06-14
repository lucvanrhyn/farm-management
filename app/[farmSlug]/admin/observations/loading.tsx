export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-48 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded animate-pulse" />

      {/* Filter bar */}
      <div className="flex gap-3">
        <div className="h-10 w-40 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
        <div className="h-10 w-36 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
        <div className="h-10 w-28 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse" />
      </div>

      {/* List rows */}
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-16 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-lg animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
