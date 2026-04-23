import AppShell from "@/components/AppShell";

/**
 * The offline fallback page. Still served by the service worker when
 * users lose connectivity, so it needs the service-worker bootstrap —
 * which now lives in AppShell after the auth-bundle split.
 */
export default function OfflineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
