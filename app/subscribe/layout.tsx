import AppShell from "@/components/AppShell";

/**
 * `/subscribe` is reached during onboarding/billing and needs
 * SessionProvider (useSession is used by the complete step). Wrap it
 * in the shared AppShell so it keeps working after the root layout was
 * slimmed down for the auth-bundle perf phase.
 */
export default function SubscribeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
