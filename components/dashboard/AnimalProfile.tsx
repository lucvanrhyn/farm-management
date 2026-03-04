"use client";

import { useState } from "react";
import { getAnimalById, getCampById, getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import { CALVING_RECORDS, TREATMENTS, OBSERVATIONS } from "@/lib/dummy-data";

type Tab = "overview" | "calving" | "treatments" | "observations";

interface Props {
  animalId: string;
  onClose: () => void;
  onBack: () => void;
}

export default function AnimalProfile({ animalId, onClose, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("overview");

  const animal = getAnimalById(animalId);
  const camp = animal ? getCampById(animal.current_camp) : undefined;

  const calvings = CALVING_RECORDS.filter((r) => r.mother_id === animalId || r.calf_id === animalId);
  const treatments = TREATMENTS.filter((t) => t.animal_id === animalId);
  const observations = OBSERVATIONS.filter((o) => o.animal_id === animalId);

  const panelBg  = "#1E1710";
  const surfaceBg = "#261C12";
  const border    = "rgba(140,100,60,0.22)";
  const textMuted = "#B09878";

  if (!animal) {
    return (
      <div className="flex flex-col h-full" style={{ background: panelBg }}>
        <div className="p-5 text-white">Dier nie gevind: {animalId}</div>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Oorsig" },
    { key: "calving", label: "Kalwings" },
    { key: "treatments", label: "Behandelings" },
    { key: "observations", label: "Waarnemings" },
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
            >{animal.animal_id}</span>
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
            <p className="text-sm font-semibold text-white mt-0.5">{getAnimalAge(animal.date_of_birth)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: textMuted }}>Huidige kamp</p>
            <p className="text-sm font-semibold text-white mt-0.5">{camp?.camp_name ?? animal.current_camp}</p>
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
            <p className="text-sm font-semibold text-white mt-0.5">{animal.date_of_birth ?? "Onbekend"}</p>
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
            {animal.mother_id && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Moeder</p>
                <p className="text-sm font-mono" style={{ color: "#C4A030" }}>{animal.mother_id}</p>
              </div>
            )}
            {animal.father_id && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Vader (Bul)</p>
                <p className="text-sm font-mono" style={{ color: "#C4A030" }}>{animal.father_id}</p>
              </div>
            )}
            {animal.notes && (
              <div style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <p className="text-xs font-semibold text-white mb-1">Notas</p>
                <p className="text-sm" style={{ color: textMuted }}>{animal.notes}</p>
              </div>
            )}
            {!animal.mother_id && !animal.father_id && !animal.notes && (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen addisionele inligting nie.</p>
            )}
          </div>
        )}

        {tab === "calving" && (
          <div className="flex flex-col gap-3">
            {calvings.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen kalwings aangeteken nie.</p>
            ) : calvings.map((c) => (
              <div key={c.calving_id} style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                <div className="flex items-start justify-between mb-2">
                  <p className="text-xs font-semibold text-white">{c.timestamp.split("T")[0]}</p>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "1px 8px",
                      borderRadius: 20,
                      background: c.calf_alive ? "rgba(74,124,89,0.2)" : "rgba(139,58,58,0.22)",
                      color:      c.calf_alive ? "#6FAB80"             : "#C25858",
                    }}
                  >
                    {c.calf_alive ? "Lewend" : "Doodgebore"}
                  </span>
                </div>
                <p className="text-xs" style={{ color: textMuted }}>
                  Kalf: <span className="font-mono text-white">{c.calf_id}</span> ·{" "}
                  {c.calf_sex === "Male" ? "Bul" : "Vers"} · {c.ease_of_birth}
                </p>
                {c.notes && <p className="text-xs mt-1" style={{ color: "rgba(176,152,120,0.55)" }}>{c.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {tab === "treatments" && (
          <div className="flex flex-col gap-3">
            {treatments.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen behandelings aangeteken nie.</p>
            ) : treatments.map((t) => {
              const clearDate = t.withdrawal_clear_date;
              const today = "2026-02-27";
              const inWithdrawal = clearDate && clearDate > today;
              return (
                <div key={t.treatment_id} style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                  <div className="flex items-start justify-between mb-1">
                    <p className="text-sm font-semibold text-white">{t.product_name}</p>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "1px 8px",
                        borderRadius: 20,
                        background: inWithdrawal ? "rgba(139,105,20,0.2)" : "rgba(74,124,89,0.2)",
                        color:      inWithdrawal ? "#C4A030"              : "#6FAB80",
                      }}
                    >
                      {inWithdrawal ? `Onthouding tot ${clearDate}` : "Vry"}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: textMuted }}>
                    {t.treatment_type} · {t.dosage ?? "—"} · {t.timestamp.split("T")[0]}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(176,152,120,0.55)" }}>Toegedien deur: {t.administered_by}</p>
                </div>
              );
            })}
          </div>
        )}

        {tab === "observations" && (
          <div className="flex flex-col gap-3">
            {observations.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: textMuted }}>Geen waarnemings aangeteken nie.</p>
            ) : observations.map((o) => {
              const details = o.details ? (() => { try { return JSON.parse(o.details!); } catch { return {}; } })() : {};
              return (
                <div key={o.observation_id} style={{ background: surfaceBg, borderRadius: 12, padding: "12px 14px" }}>
                  <div className="flex items-start justify-between mb-1">
                    <p className="text-xs font-semibold text-white capitalize">{o.type.replace("_", " ")}</p>
                    <p className="text-xs" style={{ color: textMuted }}>{o.timestamp.split("T")[0]}</p>
                  </div>
                  {details.symptoms && (
                    <p className="text-xs" style={{ color: textMuted }}>
                      Simptome: {Array.isArray(details.symptoms) ? details.symptoms.join(", ") : details.symptoms}
                    </p>
                  )}
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
