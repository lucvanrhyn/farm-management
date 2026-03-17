"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ClipboardList,
  PawPrint,
  Tent,
  Upload,
  BarChart3,
  Receipt,
} from "lucide-react";
import { SignOutButton } from "@/components/logger/SignOutButton";

const links = [
  { href: "/admin",              label: "Overview",      icon: LayoutDashboard },
  { href: "/admin/observations", label: "Observations",  icon: ClipboardList   },
  { href: "/admin/animals",      label: "Animals",       icon: PawPrint        },
  { href: "/admin/camps",        label: "Camps",         icon: Tent            },
  { href: "/admin/import",       label: "Import",        icon: Upload          },
  { href: "/admin/grafieke",     label: "Charts",        icon: BarChart3       },
  { href: "/admin/finansies",    label: "Finances",      icon: Receipt         },
];

export default function AdminNav({ active }: { active: string }) {
  return (
    <nav
      className="w-52 shrink-0 min-h-screen p-4 flex flex-col gap-1"
      style={{ background: "#1A1510", borderRight: "1px solid rgba(139,105,20,0.15)" }}
    >
      <div className="mb-6 px-3">
        <p
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "rgba(210,180,140,0.4)" }}
        >
          Admin
        </p>
      </div>

      {links.map((link) => {
        const isActive = active === link.href;
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              color: isActive ? "#F5EBD4" : "rgba(210,180,140,0.55)",
              background: isActive ? "rgba(139,105,20,0.12)" : "transparent",
            }}
          >
            {/* Animated active bar */}
            {isActive && (
              <motion.span
                layoutId="admin-nav-indicator"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                style={{ background: "#8B6914" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}

            <Icon
              className="w-4 h-4 shrink-0"
              style={{ color: isActive ? "#8B6914" : "rgba(210,180,140,0.4)" }}
            />
            <span>{link.label}</span>
          </Link>
        );
      })}

      <div className="mt-auto pt-4">
        <SignOutButton />
      </div>
    </nav>
  );
}
