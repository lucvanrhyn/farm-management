"use client";

/**
 * Animated drag-and-drop zone.
 *
 * Drag-over shifts the amber aurora glow into focus, and the lucide upload
 * icon gently floats. While loading, a shimmer bar sweeps across the dropzone
 * with "AI reading…" copy and the input is disabled so double-submits can't
 * happen. Click-to-browse works anywhere on the card (hidden native <input>).
 */

import { motion } from "framer-motion";
import { CloudUpload, FileSpreadsheet, Sparkles } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { ONBOARDING_COLORS, SPRING_SOFT } from "./theme";

type Props = {
  onFile: (file: File) => void;
  isLoading?: boolean;
  accept?: string;
};

export function FileDropzone({
  onFile,
  isLoading = false,
  accept = ".xlsx",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  function openPicker() {
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
    event.target.value = "";
  }

  const glowOpacity = isDragActive ? 1 : 0.0;

  return (
    <motion.div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      aria-disabled={isLoading}
      aria-label="Drop or select a spreadsheet file"
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      whileHover={isLoading ? undefined : { y: -2 }}
      transition={SPRING_SOFT}
      className="relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-[1.5rem] px-8 py-14 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      style={{
        background: isDragActive
          ? "linear-gradient(180deg, rgba(229,185,100,0.14) 0%, rgba(36,28,20,0.85) 100%)"
          : "linear-gradient(180deg, rgba(36,28,20,0.8) 0%, rgba(31,24,16,0.9) 100%)",
        border: isDragActive
          ? `2px dashed ${ONBOARDING_COLORS.amberBright}`
          : "2px dashed rgba(196,144,48,0.38)",
        cursor: isLoading ? "progress" : "pointer",
        minHeight: "260px",
      }}
    >
      {/* Amber aurora glow — amplifies on drag-over */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(229,185,100,0.22) 0%, transparent 60%)",
        }}
        animate={{ opacity: glowOpacity }}
        transition={{ duration: 0.25 }}
      />

      {/* Loading shimmer */}
      {isLoading ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-1/3"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(229,185,100,0.18) 50%, transparent 100%)",
          }}
          initial={{ x: "-100%" }}
          animate={{ x: "300%" }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
        />
      ) : null}

      <div className="relative flex flex-col items-center gap-4">
        {/* Icon hero */}
        <motion.div
          className="relative flex size-16 items-center justify-center rounded-2xl"
          style={{
            background: isLoading
              ? "rgba(36,28,20,0.8)"
              : "linear-gradient(135deg, rgba(196,144,48,0.18) 0%, rgba(160,82,45,0.12) 100%)",
            border: "1px solid rgba(196,144,48,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            color: ONBOARDING_COLORS.amberBright,
          }}
          animate={
            isLoading
              ? { rotate: [0, 360] }
              : { y: [-2, 2, -2] }
          }
          transition={
            isLoading
              ? { duration: 2, repeat: Infinity, ease: "linear" }
              : { duration: 3, repeat: Infinity, ease: "easeInOut" }
          }
        >
          {isLoading ? (
            <Sparkles size={26} strokeWidth={2} />
          ) : (
            <CloudUpload size={30} strokeWidth={1.8} />
          )}
        </motion.div>

        {isLoading ? (
          <>
            <p
              className="text-[1.05rem] font-semibold"
              style={{
                color: ONBOARDING_COLORS.cream,
                fontFamily: "var(--font-display)",
              }}
            >
              Reading your ledger
              <motion.span
                aria-hidden="true"
                className="ml-0.5 inline-block"
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                …
              </motion.span>
            </p>
            <p
              className="text-[12.5px]"
              style={{
                color: ONBOARDING_COLORS.muted,
                fontFamily: "var(--font-sans)",
                letterSpacing: "0.01em",
              }}
            >
              The AI usually takes under 10 seconds. Don&apos;t close this tab.
            </p>
          </>
        ) : (
          <>
            <p
              className="text-[1.1rem]"
              style={{
                color: ONBOARDING_COLORS.cream,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
              }}
            >
              {isDragActive ? "Release to upload" : "Drop your animals file"}
            </p>
            <div
              className="flex items-center gap-2 text-[12px]"
              style={{ color: ONBOARDING_COLORS.mutedDim, fontFamily: "var(--font-sans)" }}
            >
              <span>or click to browse</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <FileSpreadsheet size={12} strokeWidth={1.8} />
                .xlsx
              </span>
            </div>
          </>
        )}
      </div>

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
    </motion.div>
  );
}
