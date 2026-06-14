export default function TasksLoading() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-32 bg-[var(--ft-surface2)] rounded animate-pulse" />
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 bg-[var(--ft-surface2)] rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}
