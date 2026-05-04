export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import {
  getConsultingLeads,
  getConsultingEngagements,
  isPlatformAdmin,
  type ConsultingLead,
} from "@/lib/meta-db";
import { getSession, getUserRoleForFarm } from "@/lib/auth";


const MS_PER_APPROX_MONTH = 1000 * 60 * 60 * 24 * 30; // ~30-day approximation for revenue estimates

const zarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

function formatZar(value: number): string {
  return zarFormatter.format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(iso: string): string {
  // Created_at may be stored as 'YYYY-MM-DD HH:MM:SS' by SQLite datetime('now')
  // or as a full ISO string. Trim to date only.
  const safe = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const d = new Date(safe);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().split("T")[0];
}

function truncate(text: string | null, max = 80): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

const STATUS_STYLES: Record<
  ConsultingLead["status"],
  { bg: string; fg: string; label: string }
> = {
  new: { bg: "#1E3A5F", fg: "#93C5FD", label: "New" },
  scoped: { bg: "#3B2E14", fg: "#FCD34D", label: "Scoped" },
  quoted: { bg: "#2A1F4C", fg: "#C4B5FD", label: "Quoted" },
  active: { bg: "#15381F", fg: "#86EFAC", label: "Active" },
  complete: { bg: "#2A2520", fg: "#A8A29E", label: "Complete" },
};

function StatusBadge({ status }: { status: ConsultingLead["status"] }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export default async function ConsultingAdminPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    redirect(`/${farmSlug}/admin`);
  }

  // Codex deep-audit P1 (2026-05-03): the leads + engagements queries
  // below reach across every tenant in the meta DB. Without this gate,
  // any farm-level ADMIN of any tenant could read every other tenant's
  // consulting pipeline by visiting /<their-slug>/admin/consulting.
  // Mirror the same `isPlatformAdmin` check the matching PATCH endpoint
  // performs at app/api/admin/consulting/[id]/route.ts:30.
  const email = session.user.email;
  if (!email || !(await isPlatformAdmin(email))) {
    redirect(`/${farmSlug}/admin`);
  }

  const [leads, engagements] = await Promise.all([
    getConsultingLeads({ limit: 50 }),
    getConsultingEngagements(),
  ]);

  const totalLeads = leads.length;
  const newLeadCount = leads.filter((l) => l.status === "new").length;
  const activeEngagementCount = leads.filter(
    (l) => l.status === "active",
  ).length;

  // Rough revenue estimate: sum of setup fees + (retainer * months elapsed) across engagements.
  // Server components render once per request — wall-clock impurity here is
  // intentional (the reduce below compares engagement startedAt to "now").
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const estimatedRevenue = engagements.reduce((sum, e) => {
    const setup = e.setupFeeZar ?? 0;
    const retainer = e.retainerFeeZar ?? 0;
    if (!e.startedAt || retainer === 0) return sum + setup;
    const startedMs = new Date(e.startedAt).getTime();
    if (Number.isNaN(startedMs)) return sum + setup;
    const endMs = e.endsAt ? new Date(e.endsAt).getTime() : now;
    const clampedEnd = Number.isNaN(endMs) ? now : Math.min(endMs, now);
    const monthsElapsed = Math.max(
      0,
      (clampedEnd - startedMs) / MS_PER_APPROX_MONTH,
    );
    return sum + setup + retainer * monthsElapsed;
  }, 0);

  const cardStyle = {
    background: "#241C14",
    border: "1px solid rgba(139, 105, 20, 0.15)",
  } as const;

  const subtleText = { color: "#A8977A" } as const;

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#1A1510] min-h-screen">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-[#F5EBD4]">Consulting CRM</h1>
        <p className="text-xs mt-0.5 font-mono" style={subtleText}>
          Lead pipeline and engagement tracker
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="rounded-2xl p-4" style={cardStyle}>
          <p
            className="text-[10px] uppercase tracking-wider font-mono mb-2"
            style={subtleText}
          >
            Total Leads
          </p>
          <p className="text-2xl font-bold text-[#F5EBD4]">
            {formatNumber(totalLeads)}
          </p>
          <p className="text-[10px] mt-1 font-mono" style={subtleText}>
            latest 50 shown
          </p>
        </div>

        <div className="rounded-2xl p-4" style={cardStyle}>
          <p
            className="text-[10px] uppercase tracking-wider font-mono mb-2"
            style={subtleText}
          >
            New (Unreviewed)
          </p>
          <p className="text-2xl font-bold" style={{ color: "#93C5FD" }}>
            {formatNumber(newLeadCount)}
          </p>
          <p className="text-[10px] mt-1 font-mono" style={subtleText}>
            awaiting scoping
          </p>
        </div>

        <div className="rounded-2xl p-4" style={cardStyle}>
          <p
            className="text-[10px] uppercase tracking-wider font-mono mb-2"
            style={subtleText}
          >
            Active Engagements
          </p>
          <p className="text-2xl font-bold" style={{ color: "#86EFAC" }}>
            {formatNumber(activeEngagementCount)}
          </p>
          <p className="text-[10px] mt-1 font-mono" style={subtleText}>
            paying clients
          </p>
        </div>

        <div className="rounded-2xl p-4" style={cardStyle}>
          <p
            className="text-[10px] uppercase tracking-wider font-mono mb-2"
            style={subtleText}
            title="Retainer months approximated as 30-day periods; actual billed revenue may differ."
          >
            Estimated Revenue (approx.)
          </p>
          <p className="text-2xl font-bold" style={{ color: "#8B6914" }}>
            {formatZar(estimatedRevenue)}
          </p>
          <p className="text-[10px] mt-1 font-mono" style={subtleText}>
            across {engagements.length} engagement
            {engagements.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Leads table */}
      <div className="rounded-2xl overflow-hidden" style={cardStyle}>
        <div
          className="px-4 py-3"
          style={{ borderBottom: "1px solid rgba(139, 105, 20, 0.15)" }}
        >
          <h2 className="text-sm font-semibold text-[#F5EBD4]">Recent Leads</h2>
          <p className="text-[10px] mt-0.5 font-mono" style={subtleText}>
            Showing {leads.length} most recent
          </p>
        </div>

        {leads.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#F5EBD4] font-medium">No leads yet</p>
            <p className="text-xs mt-2 font-mono" style={subtleText}>
              Share /consulting/intake to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] uppercase tracking-wider font-mono"
                  style={{
                    color: "#A8977A",
                    background: "#1A1510",
                  }}
                >
                  <th className="px-4 py-2 font-normal">Date</th>
                  <th className="px-4 py-2 font-normal">Name</th>
                  <th className="px-4 py-2 font-normal">Farm</th>
                  <th className="px-4 py-2 font-normal">Province</th>
                  <th className="px-4 py-2 font-normal">Species</th>
                  <th className="px-4 py-2 font-normal text-right">Herd</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Notes</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    style={{
                      borderTop:
                        idx === 0
                          ? undefined
                          : "1px solid rgba(139, 105, 20, 0.1)",
                    }}
                  >
                    <td
                      className="px-4 py-3 font-mono text-xs whitespace-nowrap"
                      style={{ color: "#F5EBD4" }}
                    >
                      {formatDate(lead.createdAt)}
                    </td>
                    <td
                      className="px-4 py-3 text-xs"
                      style={{ color: "#F5EBD4" }}
                    >
                      <div className="font-medium">{lead.name}</div>
                      <div
                        className="text-[10px] font-mono mt-0.5"
                        style={subtleText}
                      >
                        {lead.email}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3 text-xs"
                      style={{ color: "#F5EBD4" }}
                    >
                      {lead.farmName ?? "—"}
                    </td>
                    <td
                      className="px-4 py-3 text-xs"
                      style={{ color: "#F5EBD4" }}
                    >
                      {lead.province ?? "—"}
                    </td>
                    <td
                      className="px-4 py-3 text-xs font-mono"
                      style={{ color: "#F5EBD4" }}
                    >
                      {lead.species.length > 0 ? lead.species.join(", ") : "—"}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-xs text-right"
                      style={{ color: "#F5EBD4" }}
                    >
                      {lead.herdSize != null ? formatNumber(lead.herdSize) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td
                      className="px-4 py-3 text-xs max-w-[320px]"
                      style={{ color: "#A8977A" }}
                      title={lead.dataNotes ?? ""}
                    >
                      {truncate(lead.dataNotes, 80) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
