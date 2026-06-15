"use client";

import { usePathname } from "next/navigation";

/**
 * AreaTransition — locked `pageTransition: fade` (FarmTrack Overhaul handoff,
 * app.jsx: `<div key={area} className={`ft-tr-${pageTransition}`}>`).
 *
 * Reproduces the prototype's AREA-LEVEL transition: the products (Home /
 * Logger / Operations·Admin / Map) cross-fade when you switch BETWEEN them,
 * but sub-navigation WITHIN an area (admin/animals → admin/reports, logger
 * grid → logger camp detail) swaps content with no fade — exactly as the
 * handoff comment specifies ("sub-navigation inside Admin swaps content
 * without remounting the shell").
 *
 * This is mounted in app/[farmSlug]/layout.tsx, which PERSISTS across
 * navigation. Because the wrapper is keyed on the area segment alone, it only
 * remounts — and the `.ft-tr-fade` animation only replays — when the area
 * actually changes. A naive `template.tsx` would instead re-fire on every
 * route change, including same-area sub-nav, which the prototype does not do.
 */
export function AreaTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Route shape is `/<farmSlug>/<area>/…` → segment [2] is the area
  // (home | logger | admin). Map lives under /admin in production, so it
  // shares the admin area — matching the no-fade-within-admin behaviour.
  const area = pathname?.split("/")[2] ?? "root";
  return (
    <div key={area} className="ft-tr-fade">
      {children}
    </div>
  );
}

export default AreaTransition;
