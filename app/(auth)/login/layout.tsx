import type { Metadata } from "next";

/**
 * Server layout for `/login` — exists solely to own the page <title> (#110).
 *
 * `login/page.tsx` is a 'use client' component and therefore cannot export
 * `metadata` (Next 16 rejects non-reserved exports from client page modules
 * at build time). A minimal server layout is the idiomatic place to set the
 * title for a client-leaf segment. It renders nothing beyond its children, so
 * it adds zero client JS and keeps the auth route group within its bundle
 * budget (see app/(auth)/layout.tsx).
 */
export const metadata: Metadata = {
  title: "Sign In — FarmTrack",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
