"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Reproduction", href: "/sheep/reproduction" },
  { label: "Health",       href: "/sheep/health",       disabled: true },
  { label: "Wool",         href: "/sheep/wool",         disabled: true },
  { label: "Losses",       href: "/sheep/losses",       disabled: true },
];

export default function SheepSubNav({ farmSlug }: { farmSlug: string }) {
  const pathname = usePathname();

  return (
    <div
      className="px-4 md:px-8 pt-5 pb-0"
      style={{ background: "#FAFAF8" }}
    >
      <div
        className="inline-flex gap-0.5 p-1 rounded-lg border"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
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
                  ? { background: "rgba(74,124,89,0.12)", color: "#3A6B49" }
                  : { color: "#9C8E7A" }
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
