"use client";

import { signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@/components/ds";

/**
 * Sign-out control with two layouts:
 *
 *  - "cluster" (default) — a back-to-home button paired with a sign-out button.
 *    Used by the admin Studio shell and the dashboard chrome, which have no
 *    other one-tap exit affordance.
 *  - "profile" — a single user-icon button that signs out. The redesigned
 *    Logger header (Camp Rounds) already carries its own top-left back chevron,
 *    so the duplicate home button is dropped and the cluster collapses to the
 *    single profile button the reference shows on the top-right.
 */
export function SignOutButton({
  variant = "cluster",
}: {
  variant?: "cluster" | "profile";
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  // pathname is e.g. "/my-farm/logger" — first segment is the farmSlug
  const farmSlug = pathname.split("/")[1];

  if (variant === "profile") {
    return (
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="ft-action-btn"
        title="Sign out"
        aria-label="Sign out"
      >
        <Icon.user size={18} />
      </button>
    );
  }

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
