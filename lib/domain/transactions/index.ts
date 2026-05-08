/**
 * Wave D (#159) — public surface of the transactions domain ops.
 *
 * Each op is a pure function on `(prisma, ...)` that returns plain
 * JSON-serialisable data and throws typed errors for business-rule
 * violations. The transport adapters (`tenantRead`, `tenantWrite`,
 * `adminWrite`) wire these into HTTP route handlers; the typed errors
 * map onto the wire envelope via `mapApiDomainError`.
 *
 * See `docs/adr/0001-route-handler-architecture.md` and
 * `tasks/wave-159-transactions-domain.md`.
 */
export {
  listTransactions,
  type ListTransactionsFilters,
} from "./list-transactions";
export {
  createTransaction,
  type CreateTransactionInput,
} from "./create-transaction";
export {
  updateTransaction,
  type UpdateTransactionInput,
} from "./update-transaction";
export {
  deleteTransaction,
  type DeleteTransactionResult,
} from "./delete-transaction";
export {
  resetTransactions,
  type ResetTransactionsResult,
} from "./reset-transactions";
export {
  TransactionNotFoundError,
  InvalidSaleTypeError,
  InvalidDateFormatError,
  TRANSACTION_NOT_FOUND,
  INVALID_SALE_TYPE,
  INVALID_DATE_FORMAT,
  VALID_SALE_TYPES,
  type SaleType,
} from "./errors";
