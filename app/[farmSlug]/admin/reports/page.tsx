import ExportButton from "@/components/admin/ExportButton";
import RotationPlanExportCard from "@/components/admin/RotationPlanExportCard";
import CostOfGainExportCard from "@/components/admin/CostOfGainExportCard";
import VeldExportCard from "@/components/admin/VeldExportCard";
import FooExportCard from "@/components/admin/FooExportCard";

export const dynamic = "force-dynamic";

interface ReportCard {
  title: string;
  description: string;
  exportType: "animals" | "withdrawal" | "calvings" | "camps" | "transactions" | "weight-history" | "reproduction" | "performance";
}

const REPORTS: ReportCard[] = [
  {
    title: "Animal List",
    description: "All active animals with camp assignment, breed, sex, and category.",
    exportType: "animals",
  },
  {
    title: "Treatment & Withdrawal",
    description: "Animals currently within a withdrawal period after treatment.",
    exportType: "withdrawal",
  },
  {
    title: "Upcoming Calvings",
    description: "Cows due to calve in the next 90 days, based on scan or insemination records.",
    exportType: "calvings",
  },
  {
    title: "Camp Summary",
    description: "Camp conditions including grazing quality, water and fence status, and last inspection date.",
    exportType: "camps",
  },
  {
    title: "Financial Transactions",
    description: "All income and expense records with amounts, categories, and animal references.",
    exportType: "transactions",
  },
  {
    title: "Weight History",
    description: "All weight recordings across animals with dates, camps, and kg values.",
    exportType: "weight-history",
  },
  {
    title: "Reproduction Summary",
    description: "Pregnancy rate, calving rate, calving interval, and SA benchmarks.",
    exportType: "reproduction",
  },
  {
    title: "Camp Performance",
    description: "LSU/ha, kg DM/ha, and days grazing remaining per camp.",
    exportType: "performance",
  },
];

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1C1815]">Reports</h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Export farm data as CSV or PDF for offline analysis and record keeping.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((report) => (
          <div
            key={report.exportType}
            className="rounded-xl p-5"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[#1C1815]">{report.title}</h2>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "#9C8E7A" }}>
                  {report.description}
                </p>
              </div>
              <div className="shrink-0 mt-0.5">
                <ExportButton
                  farmSlug={farmSlug}
                  exportType={report.exportType}
                  label="Export"
                />
              </div>
            </div>
          </div>
        ))}
        <RotationPlanExportCard farmSlug={farmSlug} />
        <CostOfGainExportCard farmSlug={farmSlug} />
        <VeldExportCard farmSlug={farmSlug} />
        <FooExportCard farmSlug={farmSlug} />
      </div>
    </div>
  );
}
