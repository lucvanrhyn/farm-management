export default function ToolsLoading() {
  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] space-y-6">
      <div className="h-8 w-56 bg-[var(--ft-surface2)] rounded animate-pulse" />
      <div className="h-4 w-80 bg-[var(--ft-surface2)] rounded animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="h-96 bg-[var(--ft-surface2)] rounded-xl animate-pulse" />
        <div className="h-96 bg-[var(--ft-surface2)] rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
