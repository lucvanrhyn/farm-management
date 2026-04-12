export default function AlertsLoading() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}
