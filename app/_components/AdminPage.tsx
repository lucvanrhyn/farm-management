/**
 * AdminPage — canonical shell for all admin-section page surfaces.
 *
 * Enforces the shared layout contract so every admin page automatically gets:
 *   - min-h-dvh  — fills viewport on mobile (uses dynamic-height-aware unit)
 *   - bg-[#FAFAF8]  — warm off-white brand background
 *   - Safe-area bottom padding  — honours iPhone home-indicator / Android gesture bar
 *   - min-w-0  — prevents overflow blowout inside flex parents
 *   - Consistent horizontal/vertical padding scale (p-4 md:p-8)
 *   - Optional `header` and `footer` slots for per-page chrome
 *
 * This is a plain React component (no async, no server-only imports) so it
 * can be tested with @testing-library/react in jsdom without special config.
 * Pages that need server data still handle fetching in their own server
 * component body and pass the result as children or props.
 *
 * Usage:
 * ```tsx
 * import AdminPage from "@/app/_components/AdminPage";
 *
 * export default function MyAdminPage() {
 *   return (
 *     <AdminPage header={<MyPageHeader />}>
 *       <MyContent />
 *     </AdminPage>
 *   );
 * }
 * ```
 */

import React from "react";

interface AdminPageProps {
  /** Page body — rendered between header (if any) and footer (if any). */
  children: React.ReactNode;
  /**
   * Optional slot rendered at the top of the shell, outside the padded content
   * area. Useful for sticky headers or breadcrumb bars that should reach the
   * full shell width.
   */
  header?: React.ReactNode;
  /**
   * Optional slot rendered at the bottom of the shell, outside the padded
   * content area. Useful for fixed action bars or pagination controls.
   */
  footer?: React.ReactNode;
  /**
   * Additional Tailwind classes forwarded onto the root element.
   * Use sparingly — prefer the shell's built-in primitives.
   */
  className?: string;
}

/**
 * Brand layout primitives applied to the root div of every admin page.
 *
 * min-h-dvh        — Dynamic Viewport Height: fills the actual visible screen on
 *                    iOS Safari and Android Chrome where the browser chrome shrinks
 *                    on scroll. Prevents short-page gaps on tall viewports.
 * bg-[#FAFAF8]     — Warm off-white brand background (Pattern A/B surface colour).
 * min-w-0          — Prevents flex/grid children from overflowing the sidebar layout.
 * pb-safe          — Tailwind CSS custom property env(safe-area-inset-bottom) via
 *                    the `pb-safe` utility. Falls back to 0 on non-notched devices.
 */
const BASE_CLASSES =
  "min-h-dvh bg-[#FAFAF8] min-w-0 pb-safe p-4 md:p-8";

export default function AdminPage({
  children,
  header,
  footer,
  className,
}: AdminPageProps) {
  const rootClass = [BASE_CLASSES, className].filter(Boolean).join(" ");

  return (
    <div data-testid="admin-page-shell" className={rootClass}>
      {header}
      {children}
      {footer}
    </div>
  );
}
