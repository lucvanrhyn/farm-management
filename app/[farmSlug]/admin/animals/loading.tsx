export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div className="h-8 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />

      {/* Filter bar */}
      <div className="flex gap-3">
        <div className="h-10 w-48 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
      </div>

      {/* Table rows */}
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
