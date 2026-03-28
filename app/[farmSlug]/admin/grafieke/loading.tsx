export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-36 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />

      {/* Tab bar */}
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-9 w-24 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
          />
        ))}
      </div>

      {/* Chart area */}
      <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
    </div>
  );
}
