import AppShell from "@/components/AppShell";

/**
 * `/farms` is an authenticated route — wrap it in the shell that
 * provides SessionProvider, service-worker registration and web-vitals
 * reporting. Split from the root layout as part of the P5 auth-bundle
 * perf work so that unauthenticated routes (under `(auth)`) stay lean.
 */
export default function FarmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
