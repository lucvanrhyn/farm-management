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
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Serwist service worker bundle — hand-lint would chase moving
    // output. The source lives in src/sw.ts and is covered by normal lint.
    "public/sw.js",
    "public/sw.js.map",
    // Sibling git worktrees (used during the 2026-04 audit waves) carry
    // their own .next/ build artifacts that flat-config eslint would walk.
    ".worktrees/**",
    // Playwright traces drop minified vendor JS into resources/.
    ".playwright-cli/**",
  ]),
]);

export default eslintConfig;
