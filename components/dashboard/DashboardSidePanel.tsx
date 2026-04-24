"use client";

/**
 * DashboardSidePanel — the slide-in detail panel on the right of the
 * dashboard map view. Shown when a camp or animal is selected.
 *
 * Extracted from DashboardClient.tsx so framer-motion / AnimatePresence
 * stays out of the dashboard route's initial JS bundle; this file is
 * loaded via `next/dynamic({ ssr: false })` from DashboardClient.
 *
 * The `panelOpen` flag controls mount/unmount so the dynamic chunk only
 * downloads when a user actually opens the panel.
 */

import { AnimatePresence, motion } from "framer-motion";
import CampDetailPanel from "./CampDetailPanel";
import AnimalProfile from "./AnimalProfile";
import type { Camp } from "@/lib/types";
import type { LiveCampStatus } from "@/lib/server/camp-status";

export default function DashboardSidePanel({
  panelOpen,
  selectedCampId,
  selectedAnimalId,
  camps,
  liveConditions,
  onSelectAnimal,
  onCloseAnimal,
  onCloseCamp,
  onBackFromAnimal,
}: {
  panelOpen: boolean;
  selectedCampId: string | null;
  selectedAnimalId: string | null;
  camps: Camp[];
  liveConditions: Record<string, LiveCampStatus>;
  onSelectAnimal: (id: string) => void;
  onCloseAnimal: () => void;
  onCloseCamp: () => void;
  onBackFromAnimal: () => void;
}) {
  return (
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          key={selectedAnimalId ?? selectedCampId}
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 380,
            boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
            zIndex: 20,
          }}
        >
          {selectedAnimalId ? (
            <AnimalProfile
              animalId={selectedAnimalId}
              onClose={onCloseAnimal}
              onBack={onBackFromAnimal}
            />
          ) : (
            <CampDetailPanel
              campId={selectedCampId!}
              camp={camps.find((c) => c.camp_id === selectedCampId)}
              onClose={onCloseCamp}
              onSelectAnimal={onSelectAnimal}
              liveCondition={liveConditions[selectedCampId!]}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
