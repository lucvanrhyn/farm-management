"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ClipboardList,
  PawPrint,
  Tent,
  Upload,
  Receipt,
  HeartPulse,
  Settings,
  FileDown,
  CheckSquare,
  Dna,
} from "lucide-react";
import { SignOutButton } from "@/components/logger/SignOutButton";

const NAV_ITEMS = [
  { path: "/admin",              label: "Overview",     icon: LayoutDashboard, group: "Data"    },
  { path: "/admin/animals",      label: "Animals",      icon: PawPrint,        group: "Data"    },
  { path: "/admin/observations", label: "Observations", icon: ClipboardList,   group: "Data"    },
  { path: "/admin/camps",        label: "Camps",        icon: Tent,            group: "Data"    },
  { path: "/admin/reproduction", label: "Reproduction", icon: HeartPulse,      group: "Data"    },
  { path: "/admin/tasks",        label: "Tasks",        icon: CheckSquare,     group: "Data"    },
  { path: "/admin/breeding-ai",  label: "Breeding AI",  icon: Dna,             group: "Data"    },
  { path: "/admin/finansies",    label: "Finances",     icon: Receipt,         group: "Finance" },
  { path: "/admin/import",       label: "Import",       icon: Upload,          group: "Tools"   },
  { path: "/admin/reports",      label: "Reports",      icon: FileDown,        group: "Tools"   },
  { path: "/admin/settings",     label: "Settings",     icon: Settings,        group: "Tools"   },
];

const GROUP_ORDER = ["Data", "Finance", "Tools"];

const linkVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { type: "spring" as const, stiffness: 90, damping: 22 } },
};

const groupVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

function NavLink({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}) {
  return (
    <motion.div variants={linkVariants}>
      <Link
        href={href}
        prefetch={false}
        title={label}
        className="relative flex items-center justify-center md:justify-start gap-2.5 px-2 md:px-2.5 py-2 md:py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{
          color: isActive ? "#F5EBD4" : "rgba(210,180,140,0.85)",
          background: isActive ? "rgba(139,105,20,0.14)" : "transparent",
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
          style={{ color: isActive ? "#8B6914" : "rgba(210,180,140,0.65)" }}
        />
        <span className="hidden md:inline">{label}</span>
      </Link>
    </motion.div>
  );
}

export default function AdminNav() {
  const pathname = usePathname();
  // pathname is e.g. "/trio-b-boerdery/admin/camps" — first segment is the farmSlug
  const farmSlug = pathname.split("/")[1];

  const groups = GROUP_ORDER.map((groupLabel) => ({
    label: groupLabel,
    links: NAV_ITEMS
      .filter((item) => item.group === groupLabel)
      .map((item) => ({
        href: `/${farmSlug}${item.path}`,
        label: item.label,
        icon: item.icon,
      })),
  }));

  return (
    <nav
      className="w-12 md:w-52 shrink-0 min-h-screen p-2 md:p-3 flex flex-col"
      style={{ background: "#1A1510", borderRight: "1px solid rgba(139,105,20,0.15)" }}
    >
      {/* FarmTrack Wordmark */}
      <div className="mb-5 px-1 md:px-1.5 pt-1">
        <div className="flex items-center justify-center md:justify-start gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              background: "rgba(139,105,20,0.2)",
              color: "#8B6914",
              border: "1px solid rgba(139,105,20,0.3)",
            }}
          >
            FT
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-semibold leading-none" style={{ color: "#F5EBD4" }}>
              FarmTrack
            </p>
            <p className="text-[10px] leading-none mt-0.5" style={{ color: "rgba(210,180,140,0.5)" }}>
              Admin
            </p>
          </div>
        </div>
      </div>

      <motion.div
        className="flex flex-col gap-4"
        variants={groupVariants}
        initial="hidden"
        animate="show"
      >
        {groups.map((group) => (
          <div key={group.label}>
            <p
              className="hidden md:block px-2.5 mb-1 text-[10px] uppercase tracking-widest font-semibold"
              style={{ color: "rgba(210,180,140,0.5)" }}
            >
              {group.label}
            </p>
            <motion.div className="flex flex-col gap-0.5" variants={groupVariants}>
              {group.links.map((link) => (
                <NavLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  icon={link.icon}
                  isActive={pathname === link.href}
                />
              ))}
            </motion.div>
          </div>
        ))}
      </motion.div>

      <div className="mt-auto pt-4">
        <SignOutButton />
      </div>
    </nav>
  );
}
