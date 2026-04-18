import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs"; // need node:fs

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "templates",
  "farmtrack-import-template.xlsx",
);

const FILENAME = "farmtrack-import-template.xlsx";

export async function GET(): Promise<Response> {
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
