import type { Metadata } from "next";

/**
 * Server layout for `/register` — owns the page <title> (#110).
 *
 * `register/page.tsx` is a 'use client' component and cannot export
 * `metadata`. This minimal server layout sets the title and renders nothing
 * beyond its children (zero client JS — see app/(auth)/login/layout.tsx).
 */
export const metadata: Metadata = {
  title: "Register — FarmTrack",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
