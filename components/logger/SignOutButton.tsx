"use client";

import { signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@/components/ds";

export function SignOutButton() {
  const router = useRouter();
  const pathname = usePathname();
  // pathname is e.g. "/my-farm/logger" — first segment is the farmSlug
  const farmSlug = pathname.split("/")[1];

  return (
    <div className="flex items-center gap-1.5">
      {/* Exit → back to hub (no sign out) */}
      <button
        onClick={() => router.push(`/${farmSlug}/home`)}
        className="ft-action-btn"
        title="Back to home"
        aria-label="Back to home"
      >
        <Icon.home size={18} />
      </button>

      {/* Sign Out → full sign out */}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="ft-action-btn is-danger"
        title="Sign out"
        aria-label="Sign out"
      >
        <Icon.signout size={18} />
      </button>
    </div>
  );
}
