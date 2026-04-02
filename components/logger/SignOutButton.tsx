"use client";

import { signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const pathname = usePathname();
  // pathname is e.g. "/my-farm/logger" — first segment is the farmSlug
  const farmSlug = pathname.split("/")[1];

  return (
    <div className="flex flex-col gap-1">
      {/* Exit → back to hub (no sign out) */}
      <button
        onClick={() => router.push(`/${farmSlug}/home`)}
        className="w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-amber-600 hover:bg-amber-950/30 hover:text-amber-500 group"
        title="Back to home"
      >
        <svg
          className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
          />
        </svg>
        <span className="hidden md:inline">Home</span>
      </button>

      {/* Sign Out → full sign out */}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-stone-600 hover:bg-red-950/30 hover:text-red-400 group"
        title="Sign out"
      >
        <svg
          className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        <span className="hidden md:inline">Sign Out</span>
      </button>
    </div>
  );
}
