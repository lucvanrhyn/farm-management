/**
 * Vitest setup file for jsdom-environment tests.
 *
 * jsdom does not ship `crypto.subtle` by default, but our parse-file helper
 * calls `crypto.subtle.digest("SHA-256", ...)` to fingerprint uploads. Polyfill
 * from Node's built-in webcrypto before any test module loads so the code path
 * runs in the browser-like environment without conditional mocks.
 *
 * Also extends Vitest's `expect` with @testing-library/jest-dom matchers so
 * component specs can use `toBeInTheDocument`, `toBeDisabled`, etc.
 */

import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  // Node's webcrypto satisfies the browser Crypto interface for our usage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = webcrypto;
}
