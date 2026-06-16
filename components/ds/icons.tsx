/**
 * FarmTrack design-system icons — monoline 24×24, stroke 1.6, currentColor.
 * Ported verbatim from the "FarmTrack Overhaul" handoff (project/icons.jsx) so
 * the reskin keeps the exact bespoke glyph set (livestock + farm-specific marks
 * that lucide-react does not provide). Every icon inherits `currentColor`.
 */
import * as React from "react";

export type IconProps = {
  size?: number;
  strokeWidth?: number;
} & Omit<React.SVGProps<SVGSVGElement>, "ref" | "width" | "height">;

function make(paths: string[]) {
  const Comp = ({ size = 18, strokeWidth = 1.6, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
  return Comp;
}

export const Icon = {
  // Logger actions
  health: make(["M12 3v18", "M3 12h18", "M7 8h10v8H7z"]),
  weigh: make(["M6 4h12l2 16H4L6 4z", "M10 8h4"]),
  treat: make(["M9 4h6l3 3v6l-3 3H9l-3-3V7l3-3z", "M9 12h6"]),
  move: make(["M5 12h13", "M14 7l5 5-5 5"]),
  calving: make(["M12 3a4 4 0 014 4v3a4 4 0 11-8 0V7a4 4 0 014-4z", "M8 14v5", "M16 14v5", "M9 21h6"]),
  repro: make(["M9 4l3 3 3-3", "M12 7v8", "M8 18a4 4 0 108 0 4 4 0 00-8 0z"]),
  death: make(["M6 6l12 12", "M18 6L6 18"]),
  // Nav / structural
  home: make(["M3 12l9-8 9 8", "M5 10v10h14V10"]),
  logger: make(["M4 4h12l4 4v12H4z", "M16 4v4h4", "M8 12h8", "M8 16h5"]),
  map: make(["M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z", "M9 4v16", "M15 6v16"]),
  admin: make(["M4 19V6", "M4 6l6-3 6 3 4-1v13l-4 1-6-3-6 3z"]),
  overview: make(["M3 3h7v7H3z", "M14 3h7v4H14z", "M14 11h7v10H14z", "M3 14h7v7H3z"]),
  alerts: make(["M12 3a6 6 0 016 6v3l2 4H4l2-4V9a6 6 0 016-6z", "M10 19a2 2 0 004 0"]),
  animals: make([
    "M5 14c0-3 3-5 7-5s7 2 7 5",
    "M7 9a2 2 0 11-4 0 2 2 0 014 0z",
    "M21 9a2 2 0 11-4 0 2 2 0 014 0z",
    "M9 6a2 2 0 11-4 0 2 2 0 014 0z",
    "M19 6a2 2 0 11-4 0 2 2 0 014 0z",
  ]),
  breeding: make(["M6 8a4 4 0 118 0", "M14 8a4 4 0 118 0", "M2 8a4 4 0 118 0", "M12 12v8", "M8 20h8"]),
  camps: make(["M3 20l9-14 9 14z", "M3 20h18", "M9 20v-4h6v4"]),
  finance: make(["M3 17l5-5 4 4 7-9", "M14 7h6v6"]),
  einstein: make([
    "M12 3v3",
    "M12 18v3",
    "M5 12H2",
    "M22 12h-3",
    "M6 6l-2-2",
    "M20 20l-2-2",
    "M6 18l-2 2",
    "M20 4l-2 2",
    "M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  ]),
  reports: make(["M5 3h11l3 3v15H5z", "M14 3v4h4", "M8 13h8", "M8 17h6", "M8 9h4"]),
  // Misc / utility
  chevron: make(["M9 6l6 6-6 6"]),
  chevronL: make(["M15 6l-6 6 6 6"]),
  chevronD: make(["M6 9l6 6 6-6"]),
  search: make(["M11 4a7 7 0 110 14 7 7 0 010-14z", "M21 21l-4.5-4.5"]),
  filter: make(["M4 5h16l-6 8v6l-4-2v-4z"]),
  plus: make(["M12 5v14", "M5 12h14"]),
  check: make(["M5 12l5 5L20 7"]),
  close: make(["M6 6l12 12", "M18 6L6 18"]),
  bell: make(["M12 3a6 6 0 016 6v3l2 4H4l2-4V9a6 6 0 016-6z", "M10 19a2 2 0 004 0"]),
  user: make(["M12 12a4 4 0 100-8 4 4 0 000 8z", "M4 21a8 8 0 0116 0"]),
  signout: make(["M16 17l5-5-5-5", "M21 12H9", "M9 21H4V3h5"]),
  refresh: make(["M20 4v6h-6", "M4 20v-6h6", "M5 9a8 8 0 0114-3l1 1", "M19 15a8 8 0 01-14 3l-1-1"]),
  pin: make(["M12 3l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 10l6-1z"]),
  water: make(["M12 3s6 7 6 12a6 6 0 11-12 0c0-5 6-12 6-12z"]),
  grass: make(["M4 21c2-6 4-9 4-12", "M10 21c2-6 4-9 4-12", "M16 21c2-6 4-9 4-12"]),
  fence: make(["M4 21V8l4-3 4 3 4-3 4 3v13", "M4 13h16", "M8 5v16", "M12 5v16", "M16 5v16"]),
  sun: make([
    "M12 3v2",
    "M12 19v2",
    "M5 12H3",
    "M21 12h-2",
    "M6 6l1.5 1.5",
    "M16.5 16.5L18 18",
    "M6 18l1.5-1.5",
    "M16.5 7.5L18 6",
    "M12 8a4 4 0 100 8 4 4 0 000-8z",
  ]),
  cloud: make(["M7 18a4 4 0 010-8 6 6 0 0111-2 4 4 0 011 8H7z"]),
  rain: make(["M7 14a4 4 0 010-8 6 6 0 0111-2 4 4 0 011 8H7z", "M9 18l-1 3", "M13 18l-1 3", "M17 18l-1 3"]),
  layers: make(["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5", "M3 18l9 5 9-5"]),
  image: make(["M4 5h16v14H4z", "M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z", "M4 16l4.5-4 3.5 3 4-4.5 4 5"]),
  locate: make(["M12 3v3", "M12 18v3", "M3 12h3", "M18 12h3", "M12 8a4 4 0 100 8 4 4 0 000-8z"]),
  expand: make(["M3 9V3h6", "M21 9V3h-6", "M3 15v6h6", "M21 15v6h-6"]),
  compass: make(["M12 3a9 9 0 100 18 9 9 0 000-18z", "M14 10l-2 6-6 2 2-6 6-2z"]),
  download: make(["M12 3v12", "M7 10l5 5 5-5", "M5 21h14"]),
  more: make(["M5 12h.01", "M12 12h.01", "M19 12h.01"]),
  edit: make(["M4 20h4l11-11-4-4L4 16z", "M14 5l4 4"]),
  trend: make(["M3 17l6-6 4 4 8-8", "M14 7h6v6"]),
  cattle: make([
    "M5 12c0-3 3-6 7-6s7 3 7 6v3a4 4 0 11-8 0",
    "M8 8c-1-2-3-3-5-3",
    "M16 8c1-2 3-3 5-3",
    "M10 16h.01",
    "M14 16h.01",
  ]),
  sheep: make([
    "M12 6a3 3 0 11-6 0 3 3 0 016 0z",
    "M18 8a3 3 0 11-6 0",
    "M5 17a4 4 0 014-4h6a4 4 0 014 4v1H5v-1z",
    "M8 22v-3",
    "M16 22v-3",
  ]),
  moon: make(["M20 14a8 8 0 11-10-10 6 6 0 0010 10z"]),
  wind: make(["M3 8h11a3 3 0 100-6", "M3 12h17a3 3 0 110 6", "M3 16h9a2 2 0 110 4"]),
  history: make(["M3 12a9 9 0 109-9", "M3 3v6h6", "M12 7v5l4 2"]),
} as const;

export type IconName = keyof typeof Icon;
