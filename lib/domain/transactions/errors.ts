/**
 * Wave D (#159) — domain-layer typed errors for `lib/domain/transactions/*`.
 *
 * Each error wraps a SCREAMING_SNAKE wire code. The `mapApiDomainError`
 * helper at `lib/server/api-errors.ts` maps these onto canonical HTTP
 * responses so the wire shape stays backward-compatible with the
 * pre-Wave-D consumers (admin /finansies UI, offline-sync queue,
 * SARS IT3 tooling).
 */

export const TRANSACTION_NOT_FOUND = "TRANSACTION_NOT_FOUND" as const;
export const INVALID_SALE_TYPE = "INVALID_SALE_TYPE" as const;
export const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT" as const;

/** Allowed `saleType` values on a Transaction row. */
export const VALID_SALE_TYPES = ["auction", "private"] as const;
export type SaleType = (typeof VALID_SALE_TYPES)[number];

/**
 * No transaction with the given id exists in the tenant. Wire: 404
 * `{ error: "TRANSACTION_NOT_FOUND" }`.
 */
export class TransactionNotFoundError extends Error {
  readonly code = TRANSACTION_NOT_FOUND;
  readonly transactionId: string;
  constructor(transactionId: string) {
    super(`Transaction not found: ${transactionId}`);
    this.name = "TransactionNotFoundError";
    this.transactionId = transactionId;
  }
}

/**
 * `saleType` field is set to a value outside the allowlist
 * (`"auction" | "private"`). Treated as a business-rule violation rather
 * than a shape error so the legacy `400 "saleType must be 'auction' or
 * 'private'"` migrates to a typed code. Wire: 422
 * `{ error: "INVALID_SALE_TYPE" }`.
 */
export class InvalidSaleTypeError extends Error {
  readonly code = INVALID_SALE_TYPE;
  readonly received: string;
  constructor(received: string) {
    super(`Invalid saleType: ${received}`);
    this.name = "InvalidSaleTypeError";
    this.received = received;
  }
}

/**
 * `from` / `to` query-string filter on `GET /api/transactions` failed
 * the YYYY-MM-DD regex. Wire: 400
 * `{ error: "INVALID_DATE_FORMAT", details: { field } }`.
 */
export class InvalidDateFormatError extends Error {
  readonly code = INVALID_DATE_FORMAT;
  readonly field: "from" | "to";
  readonly received: string;
  constructor(field: "from" | "to", received: string) {
    super(`Invalid ${field} date format: ${received}`);
    this.name = "InvalidDateFormatError";
    this.field = field;
    this.received = received;
  }
}
