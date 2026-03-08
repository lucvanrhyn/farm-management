"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-sm px-3 py-2 rounded-xl font-medium transition-colors"
      style={{
        backgroundColor: "rgba(0,0,0,0.05)",
        color: "#8A6040",
        border: "1px solid rgba(0,0,0,0.10)",
      }}
      title="Teken uit"
    >
      Uit
    </button>
  );
}
