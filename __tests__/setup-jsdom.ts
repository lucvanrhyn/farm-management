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

// Polyfill Web Storage for jsdom tests. jsdom disables localStorage /
// sessionStorage on opaque origins (about:blank default) per spec, so
// components that read/write navigation state (e.g. AdminNav accordion
// expansion memory in I8) see a Storage instance missing getItem/setItem.
// A simple in-memory implementation is sufficient for component specs.
if (typeof globalThis.window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = globalThis.window as any;
  const needsPolyfill = (s: unknown): boolean => {
    if (!s) return true;
    const anyS = s as { getItem?: unknown; setItem?: unknown };
    return typeof anyS.getItem !== "function" || typeof anyS.setItem !== "function";
  };
  const makeMemoryStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    };
  };
  if (needsPolyfill(w.localStorage)) {
    Object.defineProperty(w, "localStorage", {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
  if (needsPolyfill(w.sessionStorage)) {
    Object.defineProperty(w, "sessionStorage", {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}
