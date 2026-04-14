"use client";

import Link from "next/link";

const TABS = [
  { id: "camps",       label: "Camps"       },
  { id: "performance", label: "Performance" },
  { id: "rainfall",    label: "Rainfall"    },
  { id: "rotation",    label: "Rotation"    },
  { id: "veld",        label: "Veld"        },
  { id: "feed-on-offer", label: "Feed on Offer" },
];

export default function CampsTabBar({
  activeTab,
  farmSlug,
}: {
  activeTab: string;
  farmSlug: string;
}) {

  return (
    <div
      className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
      style={{ background: "rgba(139,105,20,0.06)" }}
    >
      {TABS.map((tab) => {
        const href = `/${farmSlug}/admin/camps?tab=${tab.id}`;
        const isActive = activeTab === tab.id;
        return (
          <Link
            key={tab.id}
            href={href}
            className="px-5 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              background: isActive ? "#FFFFFF" : "transparent",
              color: isActive ? "#1C1815" : "#9C8E7A",
              boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.1)" : undefined,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
