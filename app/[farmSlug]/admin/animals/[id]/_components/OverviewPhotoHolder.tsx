"use client";

// Client child for the Overview tab's primary-photo holder. OverviewTab is a
// server component (Prisma reads), so the interactive upload handler + busy
// state live here. Wraps the design-system <ImageHolder> primitive.
//
// onUpload: multipart-PATCH the new file to /api/animals/[id]/photo (which
// uploads to Vercel Blob + persists Animal.photoUrl), then router.refresh()
// so the new image paints from the server-rendered row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageHolder } from "@/components/ds";

interface Props {
  animalId: string;
  photoUrl: string | null;
  alt: string;
}

export default function OverviewPhotoHolder({ animalId, photoUrl, alt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleUpload(file: File): Promise<void> {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/animals/${animalId}/photo`, {
        method: "PATCH",
        body: fd,
      });
      if (!res.ok) {
        let message = `Upload failed (HTTP ${res.status}).`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          // Non-JSON body — keep the default HTTP-status message.
        }
        // Surface the server's typed message inside ImageHolder's alert.
        throw new Error(message);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ImageHolder
      src={photoUrl}
      alt={alt}
      onUpload={handleUpload}
      busy={busy}
      label="Add photo"
      changeLabel="Change photo"
    />
  );
}
