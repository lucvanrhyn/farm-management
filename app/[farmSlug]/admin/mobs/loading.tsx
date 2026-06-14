export default function MobsLoading() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-32 bg-[var(--ft-surface2)] rounded animate-pulse" />
      <div className="h-64 bg-[var(--ft-surface2)] rounded-xl animate-pulse" />
    </div>
  );
}
