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
  // Workstream F (#113) — silent-failure guard. Block NEW truly-bare
  // `catch {}` blocks so error-swallowing cannot be introduced going forward.
  // `allowEmptyCatch: false` means an empty catch is an error; ESLint's
  // `no-empty` treats a block containing a comment as non-empty by design, so
  // the existing intentional (commented) catches stay legal — only genuinely
  // empty blocks fail. Applied repo-wide; the globalIgnores above still hold.
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  // #105 cluster 2 — SSR pages/layouts must route auth through the lib/auth.ts
  // helpers (requireSession / requireFarmAdmin / requirePlatformAdmin /
  // getSession), never raw next-auth. The repo-wide audit-raw-getsession script
  // bans the getServerSession *call*; this is the import-level guard at the
  // highest-risk surface, so a hand-rolled inline SSR auth gate cannot reappear.
  {
    files: ["app/**/page.tsx", "app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next-auth",
              importNames: ["getServerSession"],
              message:
                "SSR pages/layouts must use lib/auth.ts helpers (requireSession / requireFarmAdmin / getSession), not raw getServerSession.",
            },
            {
              name: "@/lib/auth-options",
              message:
                "Do not import authOptions in pages/layouts — use the lib/auth.ts helpers (requireSession / requireFarmAdmin / getSession).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
