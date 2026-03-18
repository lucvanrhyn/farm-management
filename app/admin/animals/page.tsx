import AdminNav from "@/components/admin/AdminNav";
import AnimalsTable from "@/components/admin/AnimalsTable";
import ClearSectionButton from "@/components/admin/ClearSectionButton";
import { prisma } from "@/lib/prisma";
import type { PrismaAnimal } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminAnimalsPage() {
  const animals = (await prisma.animal.findMany({
    orderBy: [{ category: "asc" }, { animalId: "asc" }],
  })) as unknown as PrismaAnimal[];

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminNav active="/admin/animals" />
      <main className="flex-1 p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Animal Catalogue</h1>
            <p className="text-stone-500 text-sm mt-1">
              All active animals on the farm · {animals.length.toLocaleString()} animals
            </p>
          </div>
          <ClearSectionButton endpoint="/api/animals/reset" label="Clear All Animals" />
        </div>
        <AnimalsTable animals={animals} />
      </main>
    </div>
  );
}
