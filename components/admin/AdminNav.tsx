"use client";

import React from "react";
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

const groups = [
  {
    label: "Data",
    links: [
      { href: "/admin",              label: "Overview",      icon: LayoutDashboard },
      { href: "/admin/animals",      label: "Animals",       icon: PawPrint        },
      { href: "/admin/observations", label: "Observations",  icon: ClipboardList   },
      { href: "/admin/camps",        label: "Camps",         icon: Tent            },
    ],
  },
  {
    label: "Finance",
    links: [
      { href: "/admin/finansies",    label: "Finances",      icon: Receipt         },
      { href: "/admin/grafieke",     label: "Charts",        icon: BarChart3       },
    ],
  },
  {
    label: "Tools",
    links: [
      { href: "/admin/import",       label: "Import",        icon: Upload          },
    ],
  },
];

function NavLink({ href, label, icon: Icon, isActive }: { href: string; label: string; icon: React.ElementType; isActive: boolean }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors"
      style={{
        color: isActive ? "#F5EBD4" : "rgba(210,180,140,0.55)",
        background: isActive ? "rgba(139,105,20,0.12)" : "transparent",
      }}
    >
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
      <span>{label}</span>
    </Link>
  );
}

export default function AdminNav({ active }: { active: string }) {
  return (
    <nav
      className="w-48 shrink-0 min-h-screen p-3 flex flex-col"
      style={{ background: "#1A1510", borderRight: "1px solid rgba(139,105,20,0.15)" }}
    >
      <div className="mb-4 px-2">
        <p
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "rgba(210,180,140,0.4)" }}
        >
          Admin
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p
              className="px-2.5 mb-1 text-[10px] uppercase tracking-widest font-semibold"
              style={{ color: "rgba(210,180,140,0.25)" }}
            >
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.links.map((link) => (
                <NavLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  icon={link.icon}
                  isActive={active === link.href}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <SignOutButton />
      </div>
    </nav>
  );
}
