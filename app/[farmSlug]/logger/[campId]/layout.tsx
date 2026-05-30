import type { Metadata } from "next";

/**
 * Server layout for `/[farmSlug]/logger/[campId]` — owns the page <title>
 * (#110).
 *
 * The camp-logging screen (`[campId]/page.tsx`) is a 'use client' component
 * and cannot export `metadata`, and the parent `logger/layout.tsx` is also a
 * client component (it uses `useOffline`/`useParams`), so neither can set the
 * title. This minimal server layout sits between them, owns the title, and
 * renders nothing beyond its children (zero client JS).
 */
export const metadata: Metadata = {
  title: "Logger — FarmTrack",
};

export default function LoggerCampLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
