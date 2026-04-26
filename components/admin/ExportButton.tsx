"use client";

import { useState, useRef, useEffect } from "react";
import { Download } from "lucide-react";

export interface ExportButtonProps {
  farmSlug: string;
  exportType: "animals" | "withdrawal" | "calvings" | "camps" | "transactions" | "weight-history" | "reproduction" | "performance";
  label?: string;
  /** When set, appends `&species=<value>` so the export is scoped to the
   *  currently-active farm mode. Only meaningful for `exportType="animals"`.
   *  Other exporters ignore the parameter. */
  species?: "cattle" | "sheep" | "game";
}

export default function ExportButton({
  farmSlug,
  exportType,
  label = "Export",
  species,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function triggerDownload(format: "csv" | "pdf") {
    const speciesSegment = species ? `&species=${species}` : "";
    const url = `/api/${farmSlug}/export?type=${exportType}&format=${format}${speciesSegment}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          border: "1px solid #E0D5C8",
          color: "#9C8E7A",
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#6B5E50";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#C8BCAE";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#9C8E7A";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#E0D5C8";
        }}
        title={label}
      >
        <Download className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-40 rounded-lg shadow-lg z-50 overflow-hidden"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <button
            onClick={() => triggerDownload("csv")}
            className="w-full px-3 py-2 text-left text-xs transition-colors"
            style={{ color: "#1C1815" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FAF7F2")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
          >
            Download CSV
          </button>
          <button
            onClick={() => triggerDownload("pdf")}
            className="w-full px-3 py-2 text-left text-xs transition-colors border-t"
            style={{ color: "#1C1815", borderColor: "#F0EAE0" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#FAF7F2")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}
