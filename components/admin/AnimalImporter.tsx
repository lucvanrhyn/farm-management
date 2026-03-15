"use client";

import { useState, useRef } from "react";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface ImportProgress {
  processed: number;
  total: number;
}

export default function AnimalImporter() {
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
        setError(data.error ?? "Invoer het misluk");
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
              setResult({ imported: data.imported, skipped: data.skipped, errors: data.errors });
            } else if (typeof data.processed === "number") {
              setProgress({ processed: data.processed, total: data.total });
            }
          } catch {
            /* ignore malformed chunks */
          }
        }
      }
    } catch {
      setError("Netwerkkout — probeer weer");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const progressPct = progress ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Template download */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-800">Lêerformaat</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Vereiste kolomme: <code className="bg-amber-100 px-1 rounded">animal_id, sex, category, current_camp</code>
          </p>
        </div>
        <a
          href="/templates/animals-template.xlsx"
          download
          className="text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors"
        >
          Laai template af
        </a>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !loading && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          loading
            ? "border-stone-200 bg-stone-50 cursor-not-allowed"
            : "border-stone-300 cursor-pointer hover:border-stone-400 hover:bg-stone-50"
        }`}
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
            <p className="text-2xl mb-2">📄</p>
            <p className="font-semibold text-stone-700">{file.name}</p>
            <p className="text-sm text-stone-400 mt-1">{(file.size / 1024).toFixed(0)} KB — klik om te verander</p>
          </div>
        ) : (
          <div>
            <p className="text-3xl mb-3">📂</p>
            <p className="font-semibold text-stone-600">Sleep 'n lêer hierheen of klik om te kies</p>
            <p className="text-sm text-stone-400 mt-1">.xlsx, .xls of .csv</p>
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
            ? { backgroundColor: "#78350f", color: "#fff" }
            : { backgroundColor: "#e7e5e4", color: "#78716c" }
        }
      >
        {loading ? "Besig om in te voer…" : "Voer diere in"}
      </button>

      {/* Progress bar */}
      {loading && (
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs text-stone-500">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-full border-2 border-stone-300 border-t-amber-700 animate-spin"
              />
              {progress ? `${progress.processed} van ${progress.total} diere verwerk…` : "Lêer word geleë…"}
            </span>
            {progress && <span className="font-semibold text-stone-600">{progressPct}%</span>}
          </div>
          <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden">
            {progress ? (
              <div
                className="h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%`, backgroundColor: "#78350f" }}
              />
            ) : (
              <div
                className="h-2 rounded-full animate-pulse"
                style={{ width: "30%", backgroundColor: "#d6d3d1" }}
              />
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700">Fout</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-xl p-5 border ${result.skipped === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <p className="font-bold text-stone-800 mb-3">Invoerresultate</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-lg p-3 border border-green-100">
              <p className="text-2xl font-bold text-green-700">{result.imported}</p>
              <p className="text-xs text-stone-500 mt-0.5">Diere ingevoer</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
              <p className="text-xs text-stone-500 mt-0.5">Oorgeslaap</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-stone-600 mb-2">Foute ({result.errors.length}):</p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600 font-mono bg-white rounded px-2 py-1">
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
