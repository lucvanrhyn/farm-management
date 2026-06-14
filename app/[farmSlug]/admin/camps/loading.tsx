export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-36 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded animate-pulse" />

      {/* Grid of camp cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-40 bg-[var(--ft-surface2)] dark:bg-[var(--ft-text)] rounded-xl animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
