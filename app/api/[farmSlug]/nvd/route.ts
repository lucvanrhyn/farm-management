/**
 * GET  /api/[farmSlug]/nvd  — paginated list of NVDs for this farm
 * POST /api/[farmSlug]/nvd  — issue a new NVD (ADMIN only, rate limited)
 *
 * Wave G1 (#165) — migrated onto `tenantReadSlug` / `adminWriteSlug`.
 *
 * Wire-shape preservation:
 *   - 200 list shape unchanged.
 *   - 201 issue shape unchanged.
 *   - 429 rate-limit unchanged — the handler emits the same legacy 429
 *     Response from inside `handle`; `adminWriteSlug` only mints
 *     envelopes for 401/403/400 paths, so a non-2xx Response from the
 *     handler is passed through verbatim and revalidate is skipped.
 *   - 400 missing-field paths now mint typed errors
 *     (MissingRequiredFieldError) → 400 with `details.field`.
 *   - 400 transport paths now mint typed errors (InvalidTransportError)
 *     → 400 with `details.field`.
 *   - 422 issue-domain failures (in-withdrawal blockers) now surface as
 *     400 INVALID_ANIMAL_IDS via `InvalidAnimalIdsError`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, adminWriteSlug } from "@/lib/server/route";
import {
  issueNvd,
  listNvds,
  InvalidTransportError,
  MissingRequiredFieldError,
  type NvdTransportDetails,
} from "@/lib/domain/nvd";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

// ── GET — list NVDs ───────────────────────────────────────────────────────────

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") ?? "1", 10);

    const result = await listNvds(ctx.prisma, { page });
    return NextResponse.json(result);
  },
});

// ── POST — issue NVD ──────────────────────────────────────────────────────────

interface IssueBody {
  saleDate?: unknown;
  buyerName?: unknown;
  buyerAddress?: unknown;
  buyerContact?: unknown;
  destinationAddress?: unknown;
  animalIds?: unknown;
  declarationsJson?: unknown;
  transactionId?: unknown;
  transport?: unknown;
}

/**
 * Validate `body.transport` per Stock Theft Act 57/1959 §8 — when present,
 * the driver/transporter name AND vehicle reg are mandatory non-empty
 * strings. The whole field is optional (some movements are on-foot), but
 * we never want to persist a half-populated transport object that would
 * embarrass the farmer at a SAPS roadblock.
 *
 * Throws `InvalidTransportError` (400 with `details.field`) on any
 * malformed sub-field.
 */
function parseTransport(raw: unknown): NvdTransportDetails | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidTransportError(
      "transport",
      "transport must be an object with driverName and vehicleRegNumber",
    );
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.driverName !== "string" || obj.driverName.trim().length === 0) {
    throw new InvalidTransportError(
      "driverName",
      "transport.driverName is required (non-empty string)",
    );
  }
  if (
    typeof obj.vehicleRegNumber !== "string" ||
    obj.vehicleRegNumber.trim().length === 0
  ) {
    throw new InvalidTransportError(
      "vehicleRegNumber",
      "transport.vehicleRegNumber is required (non-empty string)",
    );
  }
  if (
    obj.vehicleMakeModel !== undefined &&
    obj.vehicleMakeModel !== null &&
    typeof obj.vehicleMakeModel !== "string"
  ) {
    throw new InvalidTransportError(
      "vehicleMakeModel",
      "transport.vehicleMakeModel must be a string when provided",
    );
  }

  const transport: NvdTransportDetails = {
    driverName: obj.driverName.trim(),
    vehicleRegNumber: obj.vehicleRegNumber.trim(),
  };
  if (
    typeof obj.vehicleMakeModel === "string" &&
    obj.vehicleMakeModel.trim().length > 0
  ) {
    transport.vehicleMakeModel = obj.vehicleMakeModel.trim();
  }
  return transport;
}

export const POST = adminWriteSlug<IssueBody, { farmSlug: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body, _req, params) => {
    // Rate-limit AFTER auth/role gates (the adapter has already enforced
    // those). The 429 wire shape is preserved verbatim — `adminWriteSlug`
    // passes any non-2xx Response from `handle` through unchanged and
    // revalidate is skipped for non-2xx.
    const rl = checkRateLimit(
      `nvd-issue:${params.farmSlug}`,
      10,
      10 * 60 * 1000,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many NVD requests. Please wait." },
        { status: 429 },
      );
    }

    const { saleDate, buyerName, animalIds, declarationsJson } = body;

    if (typeof saleDate !== "string" || !saleDate.trim()) {
      throw new MissingRequiredFieldError(
        "saleDate",
        "saleDate is required (YYYY-MM-DD)",
      );
    }
    if (typeof buyerName !== "string" || !buyerName.trim()) {
      throw new MissingRequiredFieldError("buyerName", "buyerName is required");
    }
    if (!Array.isArray(animalIds) || animalIds.length === 0) {
      throw new MissingRequiredFieldError(
        "animalIds",
        "animalIds must be a non-empty array",
      );
    }
    if (typeof declarationsJson !== "string") {
      throw new MissingRequiredFieldError(
        "declarationsJson",
        "declarationsJson is required",
      );
    }

    // Stock Theft Act §8 — driver + vehicle reg required when conveyed by
    // vehicle. Optional at the route boundary (on-foot is legal); validate
    // shape if present so we never persist a half-populated transport blob.
    const transport = parseTransport(body.transport);

    const record = await issueNvd(ctx.prisma, {
      saleDate: saleDate.trim(),
      buyerName: buyerName.trim(),
      buyerAddress:
        typeof body.buyerAddress === "string"
          ? body.buyerAddress.trim()
          : undefined,
      buyerContact:
        typeof body.buyerContact === "string"
          ? body.buyerContact.trim()
          : undefined,
      destinationAddress:
        typeof body.destinationAddress === "string"
          ? body.destinationAddress.trim()
          : undefined,
      animalIds: animalIds as string[],
      declarationsJson,
      generatedBy: ctx.session.user?.email ?? undefined,
      transactionId:
        typeof body.transactionId === "string" ? body.transactionId : undefined,
      ...(transport ? { transport } : {}),
    });

    return NextResponse.json(record, { status: 201 });
  },
});
