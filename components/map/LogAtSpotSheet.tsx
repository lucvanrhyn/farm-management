"use client";

/**
 * LogAtSpotSheet — bottom-sheet launched by FarmMap's long-press (desktop
 * right-click / mobile 600ms touch-hold). Offers two actions at the tapped
 * coordinate: create a task pre-seeded with lat/lng, or jump to the logger
 * with the same coords as query params.
 *
 * There is no shadcn `Sheet` primitive in this repo — we render a fixed
 * centred modal with a backdrop, which matches the existing admin-modal
 * style used in e.g. DrawCampModal and CreateObservationModal.
 */

import { useRouter } from "next/navigation";
import { MapPin, X } from "lucide-react";

interface Props {
  open: boolean;
  lngLat: { lng: number; lat: number } | null;
  farmSlug: string;
  onClose: () => void;
}

export default function LogAtSpotSheet({ open, lngLat, farmSlug, onClose }: Props) {
  const router = useRouter();

  if (!open || !lngLat) return null;

  const lat = lngLat.lat.toFixed(4);
  const lng = lngLat.lng.toFixed(4);

  const goTo = (path: string) => {
    onClose();
    router.push(path);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 bg-white"
        style={{ border: "1px solid rgba(0,0,0,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5" style={{ color: "#0ea5e9" }} />
            <h3 className="text-base font-semibold" style={{ color: "#1C1815" }}>
              Log here
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-gray-100"
          >
            <X className="w-4 h-4" style={{ color: "#9C8E7A" }} />
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
          {lat}, {lng}
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={() =>
              goTo(
                `/${farmSlug}/admin/tasks?lat=${lngLat.lat}&lng=${lngLat.lng}&createAtSpot=1`,
              )
            }
            className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-left"
            style={{ background: "#1C1815", color: "#F5EBD4" }}
          >
            Create task here
          </button>
          <button
            onClick={() =>
              goTo(`/${farmSlug}/logger?lat=${lngLat.lat}&lng=${lngLat.lng}`)
            }
            className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-left"
            style={{
              background: "#F5F2EE",
              color: "#1C1815",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            Log observation here
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-center mt-1"
            style={{ background: "transparent", color: "#9C8E7A" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
