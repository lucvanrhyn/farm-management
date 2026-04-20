import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled service worker (Serwist emits a minified bundle into public/sw.js
    // on build). Linting minified code floods the output and catches nothing
    // useful.
    "public/sw.js",
    "public/sw.js.map",
    "public/workbox-*.js",
  ]),
]);

export default eslintConfig;
