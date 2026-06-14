"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Census",           href: "/game/census" },
  { label: "Offtake Planning", href: "/game/offtake" },
  { label: "Hunt Records",     href: "/game/hunts",          disabled: true },
  { label: "Infrastructure",   href: "/game/infrastructure", disabled: true },
];

export default function GameSubNav({ farmSlug }: { farmSlug: string }) {
  const pathname = usePathname();

  return (
    <div
      className="px-4 md:px-8 pt-5 pb-0"
      style={{ background: "var(--ft-bg)" }}
    >
      <div
        className="inline-flex gap-0.5 p-1 rounded-lg border"
        style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
      >
        {TABS.map((tab) => {
          const href = `/${farmSlug}${tab.href}`;
          const isActive = pathname === href || pathname.startsWith(href + "/");

          if (tab.disabled) {
            return (
              <span
                key={tab.href}
                className="px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed"
                style={{ color: "rgba(156,142,122,0.45)" }}
                title="Coming soon"
              >
                {tab.label}
              </span>
            );
          }

          return (
            <Link
              key={tab.href}
              href={href}
              prefetch={false}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={
                isActive
                  ? { background: "var(--ft-accent-faint)", color: "var(--ft-accent)", fontWeight: 600 }
                  : { color: "var(--ft-subtle)" }
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
