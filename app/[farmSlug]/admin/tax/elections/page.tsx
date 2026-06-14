/**
 * app/[farmSlug]/admin/tax/elections/page.tsx
 *
 * Read-only listing of per-class adopted-value elections under First Schedule
 * paragraph 6 (binding per paragraph 7).
 *
 * v1 (wave/26b): read-only stub page. Insertion of elections is currently
 * SQL-only; the management UI is deferred to a follow-up wave so we ship the
 * load-bearing calculator change without coupling it to a forms+approval
 * surface that needs its own design pass.
 */

export const dynamic = "force-dynamic";

import { getPrismaForFarm } from "@/lib/farm-prisma";
import { STANDARD_VALUES_SOURCE } from "@/lib/calculators/sars-livestock-values";
import { PageHeader } from "@/components/ds";

interface ElectionRow {
  id: string;
  species: string;
  ageCategory: string;
  electedValueZar: number;
  electedYear: number;
  sarsChangeApprovalRef: string | null;
  createdAt: Date;
}

export default async function ElectionsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[var(--ft-bg)] items-center justify-center">
        <p className="text-[var(--ft-crit)]">Farm not found.</p>
      </div>
    );
  }

  let rows: ElectionRow[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows = (await (prisma as any).sarsLivestockElection.findMany({
      orderBy: [{ electedYear: "desc" }, { species: "asc" }, { ageCategory: "asc" }],
    })) as ElectionRow[];
  } catch {
    // Migration 0005 hasn't run yet on this tenant.
    rows = [];
  }

  return (
    <div className="min-h-screen bg-[var(--ft-bg)] p-6">
      <div className="max-w-4xl mx-auto">
        <PageHeader
          className="px-0 py-0 mb-2"
          title="SARS Adopted-Value Elections"
          subtitle="sars elections"
        />
        <p className="text-sm text-[var(--ft-muted)] mb-6">
          Per-class adopted standard values under First Schedule paragraph 6
          (binding per paragraph 7). The IT3 farming schedule applies the
          elected value within ±20% of the gazetted figure when valuing
          opening + closing livestock.
        </p>

        <div className="rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4 mb-6">
          <h2 className="text-base font-semibold text-[var(--ft-text)] mb-2">Source</h2>
          <p className="text-xs text-[var(--ft-muted)] leading-relaxed">
            {STANDARD_VALUES_SOURCE}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-[var(--ft-fair)] bg-[var(--ft-fair-bg)] p-4 mb-6">
            <p className="text-sm text-[var(--ft-fair)]">
              No elections recorded. The IT3 calculator will use the gazetted
              standard values for every class. To register an election while
              the management UI is being built, insert a row into
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--ft-fair-bg)] text-[var(--ft-fair)] font-mono text-xs">
                SarsLivestockElection
              </code>
              via a one-off Turso shell script — see ops runbook.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ft-surface)] text-[var(--ft-muted)] text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Species</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-right">Elected (R)</th>
                  <th className="px-3 py-2 text-right">Year</th>
                  <th className="px-3 py-2 text-left">SARS Change Ref</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--ft-border)]">
                    <td className="px-3 py-2 capitalize">{r.species}</td>
                    <td className="px-3 py-2">{r.ageCategory}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      R {r.electedValueZar}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.electedYear}</td>
                    <td className="px-3 py-2 text-[var(--ft-subtle)]">
                      {r.sarsChangeApprovalRef ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ft-text)] mb-2">
            Election rules
          </h3>
          <ul className="text-xs text-[var(--ft-muted)] list-disc pl-5 space-y-1">
            <li>
              Elected value must be within ±20% of the gazetted standard value
              (paragraph 6(1)(b)/(c)/(d)(ii)).
            </li>
            <li>
              Once made, the election is binding for all subsequent returns
              (paragraph 7) and may not be varied without SARS approval — set
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--ft-surface)] text-[var(--ft-text)] font-mono text-xs">
                sarsChangeApprovalRef
              </code>
              when re-electing a different value.
            </li>
            <li>
              Game has no gazetted standard value (IT35 §3.4.2) — elections do
              not apply.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
