import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { progressSchema } from "@/lib/build-progress";
export const dynamic = "force-dynamic";
export async function GET() {
  if (process.env.NODE_ENV !== "development")
    return new Response(null, { status: 404 });
  try {
    const contents = await readFile(
      join(process.cwd(), "work/live-progress.json"),
      "utf8",
    );
    return Response.json(progressSchema.parse(JSON.parse(contents)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Waiting for the first progress report." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
