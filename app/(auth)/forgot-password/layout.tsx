import type { Metadata } from "next";

/**
 * Server layout for `/forgot-password` — owns the page <title> (#110 pattern).
 *
 * `forgot-password/page.tsx` is a 'use client' component and cannot export
 * `metadata`. This minimal server layout sets the title and renders nothing
 * beyond its children (zero client JS — mirrors verify-email/layout.tsx).
 */
export const metadata: Metadata = {
  title: "Forgot Password — FarmTrack",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
