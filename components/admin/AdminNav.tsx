"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Bell,
  ClipboardList,
  PawPrint,
  Tent,
  Upload,
  Receipt,
  HeartPulse,
  Settings,
  FileDown,
  CheckSquare,
  ChevronDown,
  Dna,
  Users,
  Lock,
  X,
  Rabbit,
  Target,
  SlidersHorizontal,
  CreditCard,
  Crosshair,
  Calculator,
  Route,
  FileCheck2,
  Sprout,
  Wheat,
  Cloud,
  Landmark,
} from "lucide-react";
import { SignOutButton } from "@/components/logger/SignOutButton";
import { ModeSwitcher } from "@/components/ui/ModeSwitcher";
import { useFarmModeSafe, type FarmMode } from "@/lib/farm-mode";
import type { FarmTier } from "@/lib/tier";
import NotificationBell from "@/components/admin/NotificationBell";

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  group: string;
  premiumOnly?: boolean;
  /**
   * Species this item is scoped to. When set, the item:
   *   (a) is only rendered if `enabledSpecies` includes this value (N2), and
   *   (b) is treated as active whenever the pathname is anywhere under
   *       /<farmSlug>/<species>/... (N1).
   * Cattle-shared items omit this field.
   */
  species?: "sheep" | "game";
}

// ── Nav items per mode ──────────────────────────────────────────────────────

// Group labels are the bucket names rendered as accordion headers. Keep this
// list in sync with the `group` field on every nav item below. The order
// here is the render order on screen.
const GROUP_ORDER = [
  "Overview",
  "Animals",
  "Breeding",
  "Camps & Grazing",
  "Finance",
  "Compliance",
  "Admin",
] as const;
type GroupLabel = (typeof GROUP_ORDER)[number];

const CATTLE_NAV_ITEMS: NavItem[] = [
  { path: "/admin",              label: "Overview",     icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts",       label: "Alerts",       icon: Bell,            group: "Overview" },

  { path: "/admin/animals",      label: "Animals",      icon: PawPrint,        group: "Animals" },
  { path: "/admin/mobs",         label: "Mobs",         icon: Users,           group: "Animals" },
  { path: "/admin/observations", label: "Observations", icon: ClipboardList,   group: "Animals" },

  { path: "/admin/reproduction", label: "Reproduction", icon: HeartPulse,      group: "Breeding", premiumOnly: true },
  { path: "/admin/breeding-ai",  label: "Breeding AI",  icon: Dna,             group: "Breeding", premiumOnly: true },

  { path: "/admin/camps",            label: "Camps",           icon: Tent,       group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation",        icon: Route,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld",             label: "Veld",            icon: Sprout,     group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer",    label: "Feed on Offer",   icon: Wheat,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought",          label: "Drought",         icon: Cloud,      group: "Camps & Grazing", premiumOnly: true },

  { path: "/admin/finansies",             label: "Finances",     icon: Receipt,    group: "Finance", premiumOnly: true },
  { path: "/tools/break-even",            label: "Break-even",   icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd",        label: "NVDs",     icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax",        label: "SARS IT3", icon: Landmark,   group: "Compliance", premiumOnly: true },
  { path: "/admin/import",     label: "Import",   icon: Upload,     group: "Compliance" },
  { path: "/admin/reports",    label: "Reports",  icon: FileDown,   group: "Compliance" },

  { path: "/admin/tasks",                 label: "Tasks",    icon: CheckSquare,       group: "Admin" },
  { path: "/admin/settings",              label: "Settings", icon: Settings,          group: "Admin" },
  { path: "/admin/settings/species",      label: "Species",  icon: SlidersHorizontal, group: "Admin" },
];

const SHEEP_NAV_ITEMS: NavItem[] = [
  { path: "/admin",              label: "Overview",     icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts",       label: "Alerts",       icon: Bell,            group: "Overview" },

  { path: "/admin/animals",      label: "Flock",        icon: Rabbit,          group: "Animals" },
  { path: "/admin/mobs",         label: "Mobs",         icon: Users,           group: "Animals" },
  { path: "/admin/observations", label: "Observations", icon: ClipboardList,   group: "Animals" },

  { path: "/sheep/reproduction", label: "Lambing",      icon: HeartPulse,      group: "Breeding", premiumOnly: true, species: "sheep" },

  { path: "/admin/camps",            label: "Camps",         icon: Tent,       group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation",      icon: Route,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld",             label: "Veld",          icon: Sprout,     group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer",    label: "Feed on Offer", icon: Wheat,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought",          label: "Drought",       icon: Cloud,      group: "Camps & Grazing", premiumOnly: true },

  { path: "/tools/break-even",            label: "Break-even",   icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd",     label: "NVDs",     icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax",     label: "SARS IT3", icon: Landmark,   group: "Compliance", premiumOnly: true },
  { path: "/admin/import",  label: "Import",   icon: Upload,     group: "Compliance" },
  { path: "/admin/reports", label: "Reports",  icon: FileDown,   group: "Compliance" },

  { path: "/admin/tasks",                 label: "Tasks",    icon: CheckSquare,       group: "Admin" },
  { path: "/admin/settings",              label: "Settings", icon: Settings,          group: "Admin" },
  { path: "/admin/settings/species",      label: "Species",  icon: SlidersHorizontal, group: "Admin" },
];

const GAME_NAV_ITEMS: NavItem[] = [
  { path: "/admin",              label: "Overview",     icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts",       label: "Alerts",       icon: Bell,            group: "Overview" },

  { path: "/admin/observations", label: "Observations", icon: ClipboardList,   group: "Animals" },

  { path: "/game/census",        label: "Census",       icon: Crosshair,       group: "Breeding", species: "game" },
  { path: "/game/offtake",       label: "Hunting",      icon: Target,          group: "Breeding", species: "game" },

  { path: "/admin/camps",            label: "Camps",         icon: Tent,       group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation",      icon: Route,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld",             label: "Veld",          icon: Sprout,     group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer",    label: "Feed on Offer", icon: Wheat,      group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought",          label: "Drought",       icon: Cloud,      group: "Camps & Grazing", premiumOnly: true },

  { path: "/tools/break-even",            label: "Break-even",   icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd",     label: "NVDs",     icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax",     label: "SARS IT3", icon: Landmark,   group: "Compliance", premiumOnly: true },
  { path: "/admin/import",  label: "Import",   icon: Upload,     group: "Compliance" },
  { path: "/admin/reports", label: "Reports",  icon: FileDown,   group: "Compliance" },

  { path: "/admin/tasks",                 label: "Tasks",    icon: CheckSquare,       group: "Admin" },
  { path: "/admin/settings",              label: "Settings", icon: Settings,          group: "Admin" },
  { path: "/admin/settings/species",      label: "Species",  icon: SlidersHorizontal, group: "Admin" },
];

const NAV_BY_MODE: Record<FarmMode, NavItem[]> = {
  cattle: CATTLE_NAV_ITEMS,
  sheep: SHEEP_NAV_ITEMS,
  game: GAME_NAV_ITEMS,
};

// ── Sub-components ──────────────────────────────────────────────────────────

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

function LockedNavItem({
  label,
  icon: Icon,
  onClickLocked,
}: {
  label: string;
  icon: React.ElementType;
  onClickLocked: () => void;
}) {
  return (
    <motion.div variants={linkVariants}>
      <button
        type="button"
        title={`${label} — Advanced feature`}
        onClick={onClickLocked}
        className="relative flex items-center justify-center md:justify-start gap-2.5 px-2 md:px-2.5 py-2 md:py-1.5 rounded-lg text-sm font-medium w-full transition-colors"
        style={{ color: "rgba(210,180,140,0.35)", cursor: "pointer" }}
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: "rgba(210,180,140,0.25)" }} />
        <span className="hidden md:inline flex-1 text-left">{label}</span>
        <Lock className="hidden md:block w-3 h-3 shrink-0 ml-auto" style={{ color: "rgba(210,180,140,0.3)" }} />
      </button>
    </motion.div>
  );
}

function UpgradeToast({ onClose }: { onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg"
        style={{
          background: "#1A1510",
          border: "1px solid rgba(139,105,20,0.4)",
          maxWidth: "calc(100vw - 2rem)",
          minWidth: 280,
        }}
      >
        <Lock className="w-4 h-4 shrink-0" style={{ color: "#8B6914" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "#F5EBD4" }}>Advanced feature</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(210,180,140,0.65)" }}>
            Contact us to upgrade your plan
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-0.5 rounded"
          style={{ color: "rgba(210,180,140,0.5)" }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

const EXPANDED_STORAGE_KEY = (farmSlug: string) => `farmtrack-nav-expanded-${farmSlug}`;

function readStoredExpanded(farmSlug: string): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY(farmSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

function writeStoredExpanded(farmSlug: string, expanded: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXPANDED_STORAGE_KEY(farmSlug),
      JSON.stringify(Array.from(expanded)),
    );
  } catch {
    // localStorage unavailable — fail quiet, accordion still works.
  }
}

export default function AdminNav({
  tier,
  enabledSpecies,
}: {
  tier: FarmTier;
  enabledSpecies?: string[];
}) {
  const pathname = usePathname();
  const farmSlug = pathname.split("/")[1];
  const [showToast, setShowToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mode, isMultiMode } = useFarmModeSafe();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const isBasic = tier === "basic";

  // Get nav items for the current mode, then filter by enabledSpecies.
  // If enabledSpecies is undefined (defensive fallback), show everything.
  const rawNavItems = NAV_BY_MODE[mode] ?? CATTLE_NAV_ITEMS;
  const navItems = rawNavItems.filter((item) => {
    if (!item.species) return true; // cattle/shared items always render
    if (!enabledSpecies) return true; // defensive fallback
    return enabledSpecies.includes(item.species);
  });

  // N1: pathname sub-route matching for species-scoped items.
  // Any /sheep/* sub-route activates sheep-scoped items; same for game.
  const inSheepSubtree = pathname.startsWith(`/${farmSlug}/sheep/`);
  const inGameSubtree = pathname.startsWith(`/${farmSlug}/game/`);

  function isItemActive(item: NavItem, href: string): boolean {
    if (item.species === "sheep" && inSheepSubtree) return true;
    if (item.species === "game" && inGameSubtree) return true;
    if (pathname === href) return true;
    // Prefix match for all non-root items (Overview stays root-only).
    return href !== `/${farmSlug}/admin` && pathname.startsWith(href);
  }

  const groups = GROUP_ORDER.map((groupLabel) => ({
    label: groupLabel,
    links: navItems
      .filter((item) => item.group === groupLabel)
      .map((item) => {
        const href = `/${farmSlug}${item.path}`;
        return {
          href,
          label: item.label,
          icon: item.icon,
          locked: isBasic && !!item.premiumOnly,
          isActive: isItemActive(item, href),
        };
      }),
  })).filter((group) => group.links.length > 0);

  // Determine which group the current route lives in. That group auto-expands
  // on every navigation so the user always sees the active item. If no match
  // (e.g. unknown route) we fall back to "Overview".
  const activeGroupLabel: string =
    groups.find((g) => g.links.some((l) => l.isActive))?.label ?? "Overview";

  // Expanded-groups state. SSR-safe initial value: only the active group is
  // open. On mount we merge in any user preference from localStorage.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set<string>([activeGroupLabel]),
  );

  // Load persisted state on mount + re-sync whenever navigation changes the
  // active group so a user landing mid-flow still sees their route highlighted.
  useEffect(() => {
    const stored = readStoredExpanded(farmSlug);
    setExpanded((prev) => {
      const next = new Set<string>(stored ?? prev);
      next.add(activeGroupLabel); // active group always visible
      return next;
    });
  }, [farmSlug, activeGroupLabel]);

  // Ref mirror of the expanded set so toggleGroup can compute the next
  // value synchronously and persist to localStorage in the same tick as
  // the user's click — tests that read storage immediately after a click
  // would otherwise race the post-commit effect.
  const expandedRef = useRef<Set<string>>(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const toggleGroup = useCallback(
    (label: string) => {
      const prev = expandedRef.current;
      const next = new Set(prev);
      if (next.has(label)) {
        // Don't let the user collapse the group that contains the active
        // route — the chevron animation just happens, then the route
        // disappears. Keep it visible for orientation.
        if (label === activeGroupLabel) return;
        next.delete(label);
      } else {
        next.add(label);
      }
      expandedRef.current = next;
      writeStoredExpanded(farmSlug, next);
      setExpanded(next);
    },
    [activeGroupLabel, farmSlug],
  );

  function handleLockedClick() {
    setShowToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowToast(false), 3500);
  }

  return (
    <>
      <nav
        className="w-12 md:w-52 shrink-0 min-h-screen p-2 md:p-3 flex flex-col"
        style={{ background: "#1A1510", borderRight: "1px solid rgba(139,105,20,0.15)" }}
      >
        {/* FarmTrack Wordmark */}
        <div className="mb-3 px-1 md:px-1.5 pt-1">
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
              <span
                className="inline-block mt-1 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full"
                style={
                  isBasic
                    ? { background: "rgba(210,180,140,0.3)", color: "rgba(210,180,140,0.85)" }
                    : { background: "rgba(139,105,20,0.2)", color: "#8B6914" }
                }
              >
                {tier}
              </span>
            </div>
          </div>
        </div>

        {/* Mode switcher — compact, in sidebar */}
        {isMultiMode && (
          <div className="mb-4 hidden md:block">
            <ModeSwitcher variant="solid" />
          </div>
        )}

        <motion.div
          className="flex flex-col gap-2"
          variants={groupVariants}
          initial="hidden"
          animate="show"
        >
          {groups.map((group) => {
            const isOpen = expanded.has(group.label);
            const sectionId = `admin-nav-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`;
            const isActiveGroup = group.label === activeGroupLabel;
            return (
              <div key={group.label} className="flex flex-col">
                {/* Header — always visible; hidden on narrow (icon-only) nav */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isOpen}
                  aria-controls={sectionId}
                  className="hidden md:flex items-center justify-between px-2.5 py-1 rounded text-[10px] uppercase tracking-widest font-semibold transition-colors"
                  style={{
                    color: isActiveGroup
                      ? "rgba(210,180,140,0.9)"
                      : "rgba(210,180,140,0.5)",
                  }}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className="w-3 h-3 transition-transform"
                    style={{
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      color: "rgba(210,180,140,0.6)",
                    }}
                    aria-hidden="true"
                  />
                </button>

                {/* Mobile (icon-only) view always shows the links — there's no
                    room for a collapsible header at 48px wide. */}
                <div className="md:hidden flex flex-col gap-0.5">
                  {group.links.map((link) =>
                    link.locked ? (
                      <LockedNavItem
                        key={link.href}
                        label={link.label}
                        icon={link.icon}
                        onClickLocked={handleLockedClick}
                      />
                    ) : (
                      <NavLink
                        key={link.href}
                        href={link.href}
                        label={link.label}
                        icon={link.icon}
                        isActive={link.isActive}
                      />
                    ),
                  )}
                </div>

                {/* Collapsible panel — desktop only */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={sectionId}
                      role="region"
                      aria-label={`${group.label} navigation`}
                      className="hidden md:flex flex-col gap-0.5 overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      {group.links.map((link) =>
                        link.locked ? (
                          <LockedNavItem
                            key={link.href}
                            label={link.label}
                            icon={link.icon}
                            onClickLocked={handleLockedClick}
                          />
                        ) : (
                          <NavLink
                            key={link.href}
                            href={link.href}
                            label={link.label}
                            icon={link.icon}
                            isActive={link.isActive}
                          />
                        ),
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>

        <div className="mt-auto pt-4 flex flex-col gap-2">
          <NotificationBell farmSlug={farmSlug} />
          <SignOutButton />
        </div>
      </nav>

      {showToast && <UpgradeToast onClose={() => setShowToast(false)} />}
    </>
  );
}
