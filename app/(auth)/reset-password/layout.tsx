/**
 * Minimal layout for the reset-password auth route.
 * Mirrors app/(auth)/forgot-password/layout.tsx — renders children only
 * to keep the first-load JS bundle tight (no authenticated-app providers).
 */
export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
