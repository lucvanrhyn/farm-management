"use client";

/**
 * Dashed-border file dropzone for the onboarding wizard.
 *
 * Supports drag-drop AND click-to-browse via a hidden <input> referenced by
 * ref. A single click anywhere on the card opens the native file picker. When
 * `isLoading` the input is disabled and copy swaps to an "analysing" state so
 * users don't double-submit while the AI call is in flight.
 */

import { useRef, useState, type DragEvent } from "react";

type Props = {
  onFile: (file: File) => void;
  isLoading?: boolean;
  /** Comma-separated list of extensions/mimes, e.g. ".xlsx,.csv". */
  accept?: string;
};

export function FileDropzone({
  onFile,
  isLoading = false,
  accept = ".xlsx,.xls,.csv",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  function handleClick() {
    if (isLoading) return;
    inputRef.current?.click();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (isLoading) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isLoading) return;
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    if (isLoading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    // Reset so selecting the same file again still fires change.
    event.target.value = "";
  }

  return (
    <div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      aria-disabled={isLoading}
      aria-label="Drop or select a spreadsheet file"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl px-8 py-12 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      style={{
        background: isDragActive
          ? "rgba(196,144,48,0.10)"
          : "rgba(36,28,20,0.6)",
        border: isDragActive
          ? "2px dashed #C49030"
          : "2px dashed rgba(196,144,48,0.35)",
        cursor: isLoading ? "progress" : "pointer",
        opacity: isLoading ? 0.75 : 1,
        minHeight: "220px",
      }}
    >
      <span style={{ fontSize: "2.5rem", lineHeight: 1 }} aria-hidden="true">
        {isLoading ? "⏳" : "📥"}
      </span>

      {isLoading ? (
        <>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#F0DEB8",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Analysing with AI
            <span className="inline-block animate-pulse" aria-hidden="true">
              …
            </span>
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#8A6840",
              fontSize: "0.8125rem",
            }}
          >
            This usually takes under 10 seconds.
          </p>
        </>
      ) : (
        <>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#F0DEB8",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Drop your animals file here
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#8A6840",
              fontSize: "0.8125rem",
            }}
          >
            or click to browse · .xlsx, .xls, or .csv
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={isLoading}
        onChange={handleInputChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
