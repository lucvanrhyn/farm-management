"use client";

// Client wrapper that owns the modal open state. The detail page is a
// server component (Prisma reads), so the button + modal pair lives here.

import { useState } from "react";
import type { Animal, Camp } from "@prisma/client";
import EditAnimalModal from "./EditAnimalModal";

export default function EditAnimalButton({
  animal,
  camps,
}: {
  animal: Animal;
  camps: Camp[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
        style={{
          borderColor: "#E0D5C8",
          background: "#FFFFFF",
          color: "#1C1815",
        }}
      >
        Edit
      </button>
      <EditAnimalModal
        animal={animal}
        camps={camps}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => setOpen(false)}
      />
    </>
  );
}
