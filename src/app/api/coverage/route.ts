import { providerCoverage } from "@/lib/award-search/engine";
import { DIRECT_PROGRAMS } from "@/lib/award-search/direct";
export async function GET() {
  return Response.json(
    { enabled: providerCoverage(), direct: DIRECT_PROGRAMS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
