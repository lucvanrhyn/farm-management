import type { FarmOverview } from "@/lib/server/multi-farm-overview";

/**
 * Format an epoch-ms timestamp as a coarse relative-age string.
 *
 * Takes `number | null` (not `Date | null`) because the source
 * FarmOverview crosses the unstable_cache JSON boundary — epoch-ms is
 * the only Date-ish representation that survives `JSON.parse` losslessly.
 */
function formatHeartbeat(ms: number | null): string {
  if (ms === null) return "No activity";
  const diffMs = Date.now() - ms;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "< 1h ago";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * TierBadge — shows the subscription tier.
 *
 * Rule: never show "inactive" when the farm has recent activity. An active
 * farmer with a lapsed subscription sees the tier label (faded), not a loud
 * "inactive" pill that implies the *farm* is dead.
 */
function TierBadge({
  tier,
  subscriptionStatus,
  hasRecentActivity,
}: {
  tier: string;
  subscriptionStatus: string;
  hasRecentActivity: boolean;
}) {
  const isActive = subscriptionStatus === "active";
  const label = isActive || hasRecentActivity ? tier : "inactive";
  const style =
    tier === "advanced" && isActive
      ? { background: "rgba(139,105,20,0.18)", color: "#8B6914", border: "1px solid rgba(139,105,20,0.3)" }
      : { background: "rgba(210,180,140,0.12)", color: "rgba(210,180,140,0.6)", border: "1px solid rgba(210,180,140,0.2)" };

  return (
    <span
      className="inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full"
      style={style}
    >
      {label}
    </span>
  );
}

export function FarmOverviewStats({ overview }: { overview: FarmOverview }) {
  const unavailable = overview.activeAnimalCount === null;
  const hasRecentActivity = overview.lastObservationAtMs !== null;

  // Genuine error state: DB unreachable / creds missing. Tell the farmer
  // clicking the card will retry — the card itself is the link, so a
  // dedicated button would just fight the containing <a>.
  if (unavailable) {
    return (
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span
          className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(200,50,50,0.15)",
            color: "rgba(220,100,100,0.85)",
            border: "1px solid rgba(200,50,50,0.3)",
          }}
        >
          Count unavailable
        </span>
        <span className="text-[10px]" style={{ color: "#6A4E30" }}>
          click to retry
        </span>
        <TierBadge
          tier={overview.tier}
          subscriptionStatus={overview.subscriptionStatus}
          hasRecentActivity={hasRecentActivity}
        />
      </div>
    );
  }

  // Fresh/empty farm — invite the farmer to add their first animal. The
  // whole card is already a Link so the nested copy is purely directional.
  if (overview.activeAnimalCount === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
        <span className="text-[10px]" style={{ color: "#6A4E30" }}>
          <span className="font-semibold" style={{ color: "#C49030" }}>0</span>{" "}
          animals (new farm)
        </span>
        <Divider />
        <span
          className="text-[10px] font-medium"
          style={{ color: "#C49030" }}
          title="Click card to set up and add your first animal"
        >
          Add your first animal →
        </span>
        <Divider />
        <TierBadge
          tier={overview.tier}
          subscriptionStatus={overview.subscriptionStatus}
          hasRecentActivity={hasRecentActivity}
        />
      </div>
    );
  }

  // activeAnimalCount is guaranteed non-null here (unavailable branch above
  // handles the null case).
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      <Stat value={overview.activeAnimalCount!} label="animals" />
      <Divider />
      <Stat value={overview.campCount ?? 0} label="camps" />
      <Divider />
      <span
        className="text-[10px]"
        style={{ color: "#6A4E30" }}
        title="Last logged observation"
      >
        {formatHeartbeat(overview.lastObservationAtMs)}
      </span>
      <Divider />
      <TierBadge
        tier={overview.tier}
        subscriptionStatus={overview.subscriptionStatus}
        hasRecentActivity={hasRecentActivity}
      />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="text-[10px]" style={{ color: "#6A4E30" }}>
      <span className="font-semibold" style={{ color: "#C49030" }}>{value}</span>
      {" "}{label}
    </span>
  );
}

function Divider() {
  return (
    <span style={{ color: "rgba(196,144,48,0.2)", fontSize: "0.6rem" }}>•</span>
  );
}
