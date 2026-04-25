// lib/server/export/types.ts
// Shared protocol for the resource-specific export modules.

import type { PrismaClient } from "@prisma/client";

export type ExportFormat = "csv" | "pdf";

export interface ExportContext {
  prisma: PrismaClient;
  format: ExportFormat;
  /** Caller-supplied URL for resource-specific query parameters (planId, scope, view, taxYear, ...). */
  url: URL;
  /** Optional date range (YYYY-MM-DD or YYYY-MM, depending on resource). */
  from: string | null;
  to: string | null;
}

/** Output payload — caller wraps in a Response with appropriate headers. */
export interface ExportArtifact {
  contentType: string;
  filename: string;
  body: string | ArrayBuffer;
}

/**
 * Typed control-flow error for resource exporters that need to bail out
 * with a specific HTTP status (missing query parameter, snapshot not
 * found, lat/lng not configured, ...). Caller maps `.status` and
 * `.message` to the response. Avoids silently returning partial data.
 */
export class ExportRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ExportRequestError";
  }
}
