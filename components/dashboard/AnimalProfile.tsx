"use client";

import { useState, useEffect } from "react";
import { getCampById, getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { PrismaAnimal, PrismaObservation } from "@/lib/types";

type Tab = "overview" | "geskiedenis";

interface Props {
  animalId: string;
  onClose: () => void;
  onBack: () => void;
}

export default function AnimalProfile({ animalId, onClose, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [animal, setAnimal] = useState<PrismaAnimal | null | "loading">("loading");
  const [observations, setObservations] = useState<PrismaObservation[]>([]);
  const [obsLoading, setObsLoading] = useState(false);

  useEffect(() => {
    setAnimal("loading");
    fetch(`/api/animals/${encodeURIComponent(animalId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: PrismaAnimal | null) => setAnimal(data))
      .catch(() => setAnimal(null));
  }, [animalId]);

  useEffect(() => {
    if (!animalId) return;
    setObsLoading(true);
    fetch(`/api/observations?animalId=${encodeURIComponent(animalId)}&limit=100`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: PrismaObservation[]) => setObservations(Array.isArray(data) ? data : []))
      .finally(() => setObsLoading(false));
  }, [animalId]);

  const camp = animal && animal !== "loading" ? getCampById(animal.currentCamp) : undefined;

  const panelBg  = "#1E1710";
  const surfaceBg = "#261C12";
  const border    = "rgba(140,100,60,0.22)";
  const textMuted = "#B09878";

  if (animal === "loading") {
    return (
      <div className="flex flex-col h-full items-center justify-center" style={{ background: panelBg }}>
        <p className="text-sm" style={{ color: textMuted }}>Laai…</p>
      </div>
    );
  }

  if (!animal) {
    return (
      <div className="flex flex-col h-full" style={{ background: panelBg }}>
        <div className="p-5 text-white">Dier nie gevind: {animalId}</div>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Oorsig" },
    { key: "geskiedenis", label: "Geskiedenis" },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: panelBg }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: border }}>
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full text-sm"
          style={{ background: surfaceBg, color: textMuted }}
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              style={{
                fontFamily: "var(--font-dm-serif)",
                fontSize: 17,
                color: "#F5EBD4",
              }}
            >{animal.animalId}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryChipColor(animal.category)}`}>
              {getCategoryLabel(animal.category)}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: textMuted }}>
            {animal.sex === "Female" ? "Vroulik" : "Manlik"} · {animal.breed}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full text-xl"
          style={{ background: surfaceBg, color: textMuted }}
        >
          ×
        </button>
      </div>

      {/* Identity card */}
      <div className="px-4 py-4 border-b" style={{ borderColor: border, background: surfaceBg }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs" style={{ color: textMuted }}>Ouderdom</p>
            <p className="text-sm font-semibold text-white mt-0.5">{getAnimalAge(animal.dateOfBirth ?? undefined)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: textMuted }}>Huidige kamp</p>
            <p className="text-sm font-semibold text-white mt-0.5">{camp?.camp_name ?? animal.currentCamp}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: textMuted }}>Status</p>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "1px 8px",
                borderRadius: 20,
                display: "inline-block",
                marginTop: 2,
                background: animal.status === "Active" ? "rgba(74,124,89,0.2)" : "rgba(92,61,46,0.2)",
                color:      animal.status === "Active" ? "#6FAB80"             : "#B09878",
              }}
            >
              {animal.status === "Active" ? "Aktief" : animal.status}
            </span>
          </div>
          <div>
            <p className="text-xs" style={{ color: textMuted }}>Geboortedatum</p>
            <p className="text-sm font-semibold text-white mt-0.5">{animal.dateOfBirth ?? "Onbekend"}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: border }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: tab === t.key ? "#C4A030" : textMuted,
              borderBottom: tab === t.key ? "2px solid #8B6914" : "2px solid transparent",
              background: "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "overview" && (
          <div className="flex flex-col gap-3">
            {animal.motherId && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Moeder</p>
                <p className="text-sm font-mono" style={{ color: "#C4A030" }}>{animal.motherId}</p>
              </div>
            )}
            {animal.fatherId && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Vader (Bul)</p>
                <p className="text-sm font-mono" style={{ color: "#C4A030" }}>{animal.fatherId}</p>
              </div>
            )}
            {animal.notes && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Notas</p>
                <p className="text-sm" style={{ color: textMuted }}>{animal.notes}</p>
              </div>
            )}
            {!animal.motherId && !animal.fatherId && !animal.notes && (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen addisionele inligting nie.</p>
            )}
          </div>
        )}

        {tab === "geskiedenis" && (
          <div className="flex flex-col gap-3">
            {obsLoading && (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Laai geskiedenis…</p>
            )}
            {!obsLoading && observations.length === 0 && (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen geskiedenisinslae nie.</p>
            )}
            {observations.map((obs) => {
              const date = new Date(obs.observedAt).toLocaleDateString("af-ZA");
              let details: Record<string, unknown> = {};
              try { details = JSON.parse(obs.details); } catch { /* ignore */ }

              const icons: Record<string, string> = {
                health_issue: "🏥",
                animal_movement: "🚚",
                reproduction: "🐄",
                death: "💀",
                treatment: "💉",
                camp_check: "✅",
                camp_condition: "✅",
              };

              let summary = "";
              if (obs.type === "health_issue") {
                const syms = (details.symptoms as string[] | undefined)?.join(", ") ?? "";
                const sev = details.severity as string | undefined;
                summary = [syms, sev].filter(Boolean).join(" — ");
              } else if (obs.type === "animal_movement") {
                summary = `${details.from_camp ?? "?"} → ${details.to_camp ?? "?"}`;
              } else if (obs.type === "reproduction") {
                summary = String(details.event ?? "");
              } else if (obs.type === "treatment") {
                summary = [details.drug ?? details.product_name, details.dose ?? details.dosage]
                  .filter(Boolean).join(", ");
              } else if (obs.type === "death") {
                summary = String(details.cause ?? "");
              }

              return (
                <div key={obs.id} style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                  <div className="flex gap-3">
                    <span className="text-base">{icons[obs.type] ?? "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-white capitalize">{obs.type.replace(/_/g, " ")}</p>
                        <p className="text-xs shrink-0" style={{ color: textMuted }}>{date}</p>
                      </div>
                      {summary && <p className="text-xs mt-0.5" style={{ color: textMuted }}>{summary}</p>}
                      <p className="text-xs mt-0.5" style={{ color: "rgba(176,152,120,0.45)" }}>
                        {obs.loggedBy ?? "onbekend"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}
