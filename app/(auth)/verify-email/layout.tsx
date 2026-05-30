import type { Metadata } from "next";

/**
 * Server layout for `/verify-email` — owns the page <title> (#110).
 *
 * `verify-email/page.tsx` is a 'use client' component and cannot export
 * `metadata`. This minimal server layout sets the title and renders nothing
 * beyond its children (zero client JS — see app/(auth)/login/layout.tsx).
 */
export const metadata: Metadata = {
  title: "Verify Email — FarmTrack",
};

export default function VerifyEmailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
