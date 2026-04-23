/**
 * Minimal auth-route shell. Renders NOTHING beyond its children.
 *
 * `/login`, `/register` and `/verify-email` live under this route group
 * specifically so that the first-load JS bundle stays tight (~100 KB
 * brotli budget enforced by scripts/audit-bundle.ts). Do NOT import
 * any of the authenticated-app providers here — login uses next-auth's
 * `signIn()` client helper directly and does not need a React session
 * context. Any regression on this front is caught by
 * __tests__/auth/login-route-group-urls.test.ts.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
