import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { Providers } from "@/app/providers";
import { SWRegistrar } from "@/components/SWRegistrar";
import { ReportWebVitals } from "@/components/ReportWebVitals";

/**
 * Authenticated-shell wrapper. Bundles SessionProvider, service-worker
 * registration and web-vitals reporting into a single server component
 * so that *only* authenticated route subtrees pull them into the bundle.
 *
 * Auth routes (`/login`, `/register`, `/verify-email`) live under the
 * `(auth)` route group which does NOT render this shell, so their
 * first-load JS budget stays tight.
 *
 * Usage: any top-level layout that serves authenticated content should
 * wrap its children in <AppShell>.
 */
export default async function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  return (
    <>
      <SWRegistrar />
      <ReportWebVitals />
      <Providers session={session}>{children}</Providers>
    </>
  );
}
