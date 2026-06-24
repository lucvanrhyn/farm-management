"use client";

// Client wrapper for the animal-detail Investment tab's "Add cost / income"
// button. Opens the SAME TransactionModal pre-tagged to this animal, so a cost
// logged here lands on the animal's per-animal profitability immediately.
// router.refresh() repaints the server-rendered investment donut/table on save.

import { useState } from "react";
import { useRouter } from "next/navigation";
import TransactionModal from "@/components/admin/finansies/TransactionModal";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Props {
  /** Business animal tag (e.g. "B042") — pre-tags the new transaction. */
  animalId: string;
  /** Active species — scopes the modal's AnimalPicker (though it is pre-tagged). */
  species?: string | null;
  incomeCategories: Category[];
  expenseCategories: Category[];
}

export default function InvestmentTabActions({
  animalId,
  species,
  incomeCategories,
  expenseCategories,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-1.5 rounded-xl text-sm font-medium transition-colors"
        style={{ background: "var(--ft-good)", color: "var(--ft-fair-bg)" }}
      >
        ＋ Add cost / income
      </button>
      {open && (
        <TransactionModal
          animalId={animalId}
          species={species}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
