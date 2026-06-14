export default function ReportsLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-32 bg-[var(--ft-surface2)] rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-24 bg-[var(--ft-surface2)] rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}
