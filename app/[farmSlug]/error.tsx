"use client";

export default function FarmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] bg-[#FAFAF8] items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-bold mb-2" style={{ color: "#1C1815" }}>
          Something went wrong
        </h2>
        <p className="text-sm mb-4" style={{ color: "#9C8E7A" }}>
          An unexpected error occurred. Please try again.
          {error.digest && (
            <span className="block text-xs mt-1 opacity-60">
              Error ID: {error.digest}
            </span>
          )}
        </p>
        <button
          onClick={reset}
          className="px-5 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#4A7C59", color: "#FFFFFF" }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
