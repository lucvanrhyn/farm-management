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
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
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
    <div className="min-h-screen bg-[#FAFAF8] p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#1C1815] mb-2">
          SARS Adopted-Value Elections
        </h1>
        <p className="text-sm text-zinc-600 mb-6">
          Per-class adopted standard values under First Schedule paragraph 6
          (binding per paragraph 7). The IT3 farming schedule applies the
          elected value within ±20% of the gazetted figure when valuing
          opening + closing livestock.
        </p>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 mb-6">
          <h2 className="text-base font-semibold text-[#1C1815] mb-2">Source</h2>
          <p className="text-xs text-zinc-600 leading-relaxed">
            {STANDARD_VALUES_SOURCE}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
            <p className="text-sm text-amber-900">
              No elections recorded. The IT3 calculator will use the gazetted
              standard values for every class. To register an election while
              the management UI is being built, insert a row into
              <code className="mx-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-xs">
                SarsLivestockElection
              </code>
              via a one-off Turso shell script — see ops runbook.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase">
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
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-3 py-2 capitalize">{r.species}</td>
                    <td className="px-3 py-2">{r.ageCategory}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      R {r.electedValueZar}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.electedYear}</td>
                    <td className="px-3 py-2 text-zinc-500">
                      {r.sarsChangeApprovalRef ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-[#1C1815] mb-2">
            Election rules
          </h3>
          <ul className="text-xs text-zinc-600 list-disc pl-5 space-y-1">
            <li>
              Elected value must be within ±20% of the gazetted standard value
              (paragraph 6(1)(b)/(c)/(d)(ii)).
            </li>
            <li>
              Once made, the election is binding for all subsequent returns
              (paragraph 7) and may not be varied without SARS approval — set
              <code className="mx-1 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-800 font-mono text-xs">
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
