/**
 * Shared Operations navigation model.
 *
 * Ported verbatim from the original <AdminNav> (per-mode nav arrays, group
 * order, tier/species filtering and active-route logic) so the new Studio
 * shell, the ⌘K command palette and the AreaDock all drive off ONE source of
 * truth and preserve the exact routing, tier-locking and species-scoping
 * behaviour the app shipped with.
 */
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
  Dna,
  Users,
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
  Sparkles,
} from "lucide-react";
import type { FarmMode } from "@/lib/farm-mode";
import type { FarmTier } from "@/lib/tier";

export interface NavChild {
  path: string;
  label: string;
  premiumOnly?: boolean;
}

export interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  group: string;
  premiumOnly?: boolean;
  species?: "sheep" | "game";
  children?: NavChild[];
}

export const GROUP_ORDER = [
  "Overview",
  "Animals",
  "Breeding",
  "Camps & Grazing",
  "Finance",
  "Compliance",
  "Today",
] as const;

const TASKS_CHILDREN: NavChild[] = [
  { path: "/admin/tasks", label: "Tasks" },
  { path: "/admin/map/route-today", label: "Route Today" },
  { path: "/admin/settings/tasks", label: "Templates" },
];

const CATTLE_NAV_ITEMS: NavItem[] = [
  { path: "/admin", label: "Overview", icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts", label: "Alerts", icon: Bell, group: "Overview" },

  { path: "/admin/animals", label: "Animals", icon: PawPrint, group: "Animals" },
  { path: "/admin/mobs", label: "Mobs", icon: Users, group: "Animals" },
  { path: "/admin/observations", label: "Observations", icon: ClipboardList, group: "Animals" },

  { path: "/admin/reproduction", label: "Reproduction", icon: HeartPulse, group: "Breeding", premiumOnly: true },
  { path: "/admin/breeding-ai", label: "Breeding AI", icon: Dna, group: "Breeding", premiumOnly: true },

  { path: "/admin/camps", label: "Camps", icon: Tent, group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation", icon: Route, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld", label: "Veld", icon: Sprout, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer", label: "Feed on Offer", icon: Wheat, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought", label: "Drought", icon: Cloud, group: "Camps & Grazing", premiumOnly: true },

  { path: "/admin/finansies", label: "Finances", icon: Receipt, group: "Finance", premiumOnly: true },
  { path: "/tools/break-even", label: "Break-even", icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd", label: "NVDs", icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax", label: "SARS IT3", icon: Landmark, group: "Compliance", premiumOnly: true },
  { path: "/admin/import", label: "Import", icon: Upload, group: "Compliance" },
  { path: "/admin/reports", label: "Reports", icon: FileDown, group: "Compliance" },

  { path: "/admin/einstein", label: "Einstein", icon: Sparkles, group: "Today", premiumOnly: true },
  { path: "/admin/tasks", label: "Tasks", icon: CheckSquare, group: "Today", children: TASKS_CHILDREN },
  { path: "/admin/settings", label: "Settings", icon: Settings, group: "Today" },
  { path: "/admin/settings/species", label: "Species", icon: SlidersHorizontal, group: "Today" },
  { path: "/admin/settings/alerts", label: "Alert Settings", icon: Bell, group: "Today" },
];

const SHEEP_NAV_ITEMS: NavItem[] = [
  { path: "/admin", label: "Overview", icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts", label: "Alerts", icon: Bell, group: "Overview" },

  { path: "/admin/animals", label: "Flock", icon: Rabbit, group: "Animals" },
  { path: "/admin/mobs", label: "Mobs", icon: Users, group: "Animals" },
  { path: "/admin/observations", label: "Observations", icon: ClipboardList, group: "Animals" },

  { path: "/sheep/reproduction", label: "Lambing", icon: HeartPulse, group: "Breeding", premiumOnly: true, species: "sheep" },

  { path: "/admin/camps", label: "Camps", icon: Tent, group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation", icon: Route, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld", label: "Veld", icon: Sprout, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer", label: "Feed on Offer", icon: Wheat, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought", label: "Drought", icon: Cloud, group: "Camps & Grazing", premiumOnly: true },

  { path: "/tools/break-even", label: "Break-even", icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd", label: "NVDs", icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax", label: "SARS IT3", icon: Landmark, group: "Compliance", premiumOnly: true },
  { path: "/admin/import", label: "Import", icon: Upload, group: "Compliance" },
  { path: "/admin/reports", label: "Reports", icon: FileDown, group: "Compliance" },

  { path: "/admin/einstein", label: "Einstein", icon: Sparkles, group: "Today", premiumOnly: true },
  { path: "/admin/tasks", label: "Tasks", icon: CheckSquare, group: "Today", children: TASKS_CHILDREN },
  { path: "/admin/settings", label: "Settings", icon: Settings, group: "Today" },
  { path: "/admin/settings/species", label: "Species", icon: SlidersHorizontal, group: "Today" },
  { path: "/admin/settings/alerts", label: "Alert Settings", icon: Bell, group: "Today" },
];

const GAME_NAV_ITEMS: NavItem[] = [
  { path: "/admin", label: "Overview", icon: LayoutDashboard, group: "Overview" },
  { path: "/admin/alerts", label: "Alerts", icon: Bell, group: "Overview" },

  { path: "/admin/observations", label: "Observations", icon: ClipboardList, group: "Animals" },

  { path: "/game/census", label: "Census", icon: Crosshair, group: "Breeding", species: "game" },
  { path: "/game/offtake", label: "Hunting", icon: Target, group: "Breeding", species: "game" },

  { path: "/admin/camps", label: "Camps", icon: Tent, group: "Camps & Grazing" },
  { path: "/tools/rotation-planner", label: "Rotation", icon: Route, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/veld", label: "Veld", icon: Sprout, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/feed-on-offer", label: "Feed on Offer", icon: Wheat, group: "Camps & Grazing", premiumOnly: true },
  { path: "/tools/drought", label: "Drought", icon: Cloud, group: "Camps & Grazing", premiumOnly: true },

  { path: "/tools/break-even", label: "Break-even", icon: Calculator, group: "Finance", premiumOnly: true },
  { path: "/admin/settings/subscription", label: "Subscription", icon: CreditCard, group: "Finance" },

  { path: "/tools/nvd", label: "NVDs", icon: FileCheck2, group: "Compliance", premiumOnly: true },
  { path: "/tools/tax", label: "SARS IT3", icon: Landmark, group: "Compliance", premiumOnly: true },
  { path: "/admin/import", label: "Import", icon: Upload, group: "Compliance" },
  { path: "/admin/reports", label: "Reports", icon: FileDown, group: "Compliance" },

  { path: "/admin/einstein", label: "Einstein", icon: Sparkles, group: "Today", premiumOnly: true },
  { path: "/admin/tasks", label: "Tasks", icon: CheckSquare, group: "Today", children: TASKS_CHILDREN },
  { path: "/admin/settings", label: "Settings", icon: Settings, group: "Today" },
  { path: "/admin/settings/species", label: "Species", icon: SlidersHorizontal, group: "Today" },
  { path: "/admin/settings/alerts", label: "Alert Settings", icon: Bell, group: "Today" },
];

export const NAV_BY_MODE: Record<FarmMode, NavItem[]> = {
  cattle: CATTLE_NAV_ITEMS,
  sheep: SHEEP_NAV_ITEMS,
  game: GAME_NAV_ITEMS,
};

/** Quick-switch items shown in the Studio floating dock (rest live behind "More"/⌘K). */
export const PRIMARY_PATHS = [
  "/admin",
  "/admin/animals",
  "/admin/camps",
  "/admin/finansies",
  "/admin/einstein",
] as const;

export interface ResolvedNavLink {
  href: string;
  label: string;
  icon: React.ElementType;
  locked: boolean;
  isActive: boolean;
  children?: { href: string; label: string; isActive: boolean; locked: boolean }[];
}

export interface ResolvedNavGroup {
  label: string;
  links: ResolvedNavLink[];
}

/**
 * Build the resolved, filtered, active-aware nav groups for the current
 * request. Mirrors the original AdminNav logic 1:1.
 */
export function buildNavGroups(opts: {
  mode: FarmMode;
  tier: FarmTier;
  enabledSpecies?: readonly string[];
  enabledModes: readonly string[];
  farmSlug: string;
  pathname: string;
}): ResolvedNavGroup[] {
  const { mode, tier, enabledSpecies, enabledModes, farmSlug, pathname } = opts;
  const isBasic = tier === "basic";

  const rawNavItems = NAV_BY_MODE[mode] ?? CATTLE_NAV_ITEMS;
  const navItems = rawNavItems.filter((item) => {
    if (item.path === "/admin/settings/species" && enabledModes.length <= 1) return false;
    if (!item.species) return true;
    if (!enabledSpecies) return true;
    return enabledSpecies.includes(item.species);
  });

  const inSheepSubtree = pathname.startsWith(`/${farmSlug}/sheep/`);
  const inGameSubtree = pathname.startsWith(`/${farmSlug}/game/`);

  function isItemActive(item: NavItem, href: string): boolean {
    if (item.species === "sheep" && inSheepSubtree) return true;
    if (item.species === "game" && inGameSubtree) return true;
    if (pathname === href) return true;
    return href !== `/${farmSlug}/admin` && pathname.startsWith(href);
  }

  return GROUP_ORDER.map((groupLabel) => ({
    label: groupLabel,
    links: navItems
      .filter((item) => item.group === groupLabel)
      .map((item): ResolvedNavLink => {
        const href = `/${farmSlug}${item.path}`;
        const children = item.children?.map((c) => {
          const childPathOnly = c.path.split("?")[0];
          const childHrefNoQuery = `/${farmSlug}${childPathOnly}`;
          return {
            href: `/${farmSlug}${c.path}`,
            label: c.label,
            isActive: pathname === childHrefNoQuery,
            locked: isBasic && !!c.premiumOnly,
          };
        });
        return {
          href,
          label: item.label,
          icon: item.icon,
          locked: isBasic && !!item.premiumOnly,
          isActive: isItemActive(item, href),
          children,
        };
      }),
  })).filter((g) => g.links.length > 0);
}

/** Flatten resolved groups to a single ordered link list (for ⌘K / dock). */
export function flattenNav(groups: ResolvedNavGroup[]): ResolvedNavLink[] {
  return groups.flatMap((g) => g.links);
}
