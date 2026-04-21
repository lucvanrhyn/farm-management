import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export const runtime = "nodejs"; // need node:fs

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "templates",
  "farmtrack-import-template.xlsx",
);

const FILENAME = "farmtrack-import-template.xlsx";

export async function GET(): Promise<Response> {
  // Gate behind an authenticated session: the template leaks the exact column
  // schema the import pipeline expects, which is information we only want to
  // hand to logged-in tenants walking through onboarding.
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    await stat(TEMPLATE_PATH);
  } catch {
    return new Response(
      JSON.stringify({
        error:
          "Template asset not generated. Run `pnpm tsx scripts/create-template.ts`.",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const buf = await readFile(TEMPLATE_PATH);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Emit both filename forms per RFC 5987 — the static name is pure ASCII
      // today, but the pattern is now copy-pasted across the codebase and this
      // keeps us safe if FILENAME ever becomes dynamic or non-ASCII.
      "Content-Disposition": `attachment; filename="${FILENAME}"; filename*=UTF-8''${encodeURIComponent(FILENAME)}`,
      "Cache-Control": "public, max-age=300", // 5 min — asset is stable per build
      "Content-Length": buf.byteLength.toString(),
    },
  });
}
