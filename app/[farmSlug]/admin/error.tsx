"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] bg-[var(--ft-bg)] items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--ft-text)" }}>
          Something went wrong
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--ft-subtle)" }}>
          An unexpected error occurred. Please try again.
          {error.digest && (
            <span className="block text-xs mt-1 opacity-60">Error ID: {error.digest}</span>
          )}
        </p>
        <button
          onClick={reset}
          className="px-5 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--ft-good)", color: "#FFFFFF" }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
