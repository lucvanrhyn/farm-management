"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ImportResult {
  imported: number;
  skipped: number;
  campsCreated: number;
  errors: string[];
}

interface ImportProgress {
  processed: number;
  total: number;
}

export default function AnimalImporter() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError(null);
    setProgress(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) {
      setFile(f);
      setResult(null);
      setError(null);
      setProgress(null);
    }
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/animals/import", { method: "POST", body: formData });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Import failed");
        return;
      }

      // Read SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              setResult({ imported: data.imported, skipped: data.skipped, campsCreated: data.campsCreated ?? 0, errors: data.errors });
              if (data.imported > 0 || data.campsCreated > 0) router.refresh();
            } else if (typeof data.processed === "number") {
              setProgress({ processed: data.processed, total: data.total });
            }
          } catch {
            /* ignore malformed chunks */
          }
        }
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const progressPct = progress ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Template download */}
      <div style={{
        background: "#F5F2EE",
        border: "1px solid #E0D5C8",
        borderRadius: "0.75rem",
        padding: "1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1C1815" }}>Two-Tab Template</p>
          <p style={{ fontSize: "0.75rem", color: "#6B5C4E", marginTop: "0.125rem" }}>
            Sheet 1:{" "}
            <code style={{ background: "rgba(122,92,30,0.12)", padding: "0 0.25rem", borderRadius: "0.25rem", color: "#8B6914" }}>
              Camps
            </code>
            {" "}— Sheet 2:{" "}
            <code style={{ background: "rgba(122,92,30,0.12)", padding: "0 0.25rem", borderRadius: "0.25rem", color: "#8B6914" }}>
              Animals
            </code>
          </p>
        </div>
        <a
          href="/templates/farmtrack-import-template.xlsx"
          download
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#8B6914",
            border: "1px solid #E0D5C8",
            borderRadius: "0.5rem",
            padding: "0.375rem 0.75rem",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Download template
        </a>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !loading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${loading ? "rgba(122,92,30,0.15)" : "rgba(122,92,30,0.3)"}`,
          borderRadius: "0.75rem",
          padding: "2.5rem",
          textAlign: "center",
          cursor: loading ? "not-allowed" : "pointer",
          background: loading ? "rgba(122,92,30,0.03)" : "transparent",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
        {file ? (
          <div>
            <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📄</p>
            <p style={{ fontWeight: 600, color: "#1C1815" }}>{file.name}</p>
            <p style={{ fontSize: "0.875rem", color: "#9C8E7A", marginTop: "0.25rem" }}>
              {(file.size / 1024).toFixed(0)} KB — click to change
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: "1.875rem", marginBottom: "0.75rem" }}>📂</p>
            <p style={{ fontWeight: 600, color: "#6B5C4E" }}>Drop a file here or click to select</p>
            <p style={{ fontSize: "0.875rem", color: "#9C8E7A", marginTop: "0.25rem" }}>.xlsx, .xls or .csv</p>
          </div>
        )}
      </div>

      {/* Import button */}
      <button
        onClick={handleImport}
        disabled={!file || loading}
        className="w-full py-3 rounded-xl font-bold transition-colors disabled:cursor-not-allowed"
        style={
          file && !loading
            ? { backgroundColor: "#8B6914", color: "#F5EBD4" }
            : { backgroundColor: "rgba(122,92,30,0.08)", color: "#9C8E7A" }
        }
      >
        {loading ? "Importing..." : "Import Animals"}
      </button>

      {/* Progress bar */}
      {loading && (
        <div className="space-y-2">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "#9C8E7A" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  borderRadius: "50%",
                  border: "2px solid #E0D5C8",
                  borderTopColor: "#8B6914",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              {progress ? `${progress.processed} of ${progress.total} animals processed...` : "Loading file..."}
            </span>
            {progress && <span style={{ fontWeight: 600, color: "#6B5C4E" }}>{progressPct}%</span>}
          </div>
          <div style={{ width: "100%", background: "#F5F2EE", borderRadius: "9999px", height: "0.5rem", overflow: "hidden" }}>
            {progress ? (
              <div
                style={{
                  height: "0.5rem",
                  borderRadius: "9999px",
                  transition: "width 0.3s",
                  width: `${progressPct}%`,
                  backgroundColor: "#8B6914",
                }}
              />
            ) : (
              <div
                style={{
                  height: "0.5rem",
                  borderRadius: "9999px",
                  width: "30%",
                  backgroundColor: "rgba(122,92,30,0.2)",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "rgba(139,20,20,0.08)",
          border: "1px solid rgba(160,50,50,0.3)",
          borderRadius: "0.75rem",
          padding: "1rem",
        }}>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#C0574C" }}>Error</p>
          <p style={{ fontSize: "0.875rem", color: "rgba(192,87,76,0.85)", marginTop: "0.25rem" }}>{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          borderRadius: "0.75rem",
          padding: "1.25rem",
          border: `1px solid ${result.skipped === 0 ? "rgba(74,124,89,0.35)" : "#E0D5C8"}`,
          background: result.skipped === 0 ? "rgba(74,124,89,0.08)" : "#F5F2EE",
        }}>
          <p style={{ fontWeight: 700, color: "#1C1815", marginBottom: "0.75rem" }}>Import Results</p>
          <div style={{ display: "grid", gridTemplateColumns: result.campsCreated > 0 ? "1fr 1fr 1fr" : "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{
              background: "rgba(74,124,89,0.12)",
              border: "1px solid rgba(74,124,89,0.25)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
            }}>
              <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#4A7C59" }}>{result.imported}</p>
              <p style={{ fontSize: "0.75rem", color: "#9C8E7A", marginTop: "0.125rem" }}>Animals imported</p>
            </div>
            {result.campsCreated > 0 && (
              <div style={{
                background: "rgba(74,124,89,0.08)",
                border: "1px solid rgba(74,124,89,0.2)",
                borderRadius: "0.5rem",
                padding: "0.75rem",
              }}>
                <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#4A7C59" }}>{result.campsCreated}</p>
                <p style={{ fontSize: "0.75rem", color: "#9C8E7A", marginTop: "0.125rem" }}>Camps created</p>
              </div>
            )}
            <div style={{
              background: "#FFFFFF",
              border: "1px solid #E0D5C8",
              borderRadius: "0.5rem",
              padding: "0.75rem",
            }}>
              <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#8B6914" }}>{result.skipped}</p>
              <p style={{ fontSize: "0.75rem", color: "#9C8E7A", marginTop: "0.125rem" }}>Skipped</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6B5C4E", marginBottom: "0.5rem" }}>
                Errors ({result.errors.length}):
              </p>
              <ul style={{ maxHeight: "10rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {result.errors.map((e, i) => (
                  <li key={i} style={{
                    fontSize: "0.75rem",
                    color: "#C0574C",
                    fontFamily: "monospace",
                    background: "rgba(139,20,20,0.08)",
                    borderRadius: "0.25rem",
                    padding: "0.125rem 0.5rem",
                  }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
