export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-950 text-stone-100 px-6 text-center">
      <h1 className="text-2xl font-semibold mb-3">No connection</h1>
      <p className="text-stone-400 text-sm">
        This page is not available offline. Make sure you open the app online first so it can cache.
      </p>
    </div>
  );
}
