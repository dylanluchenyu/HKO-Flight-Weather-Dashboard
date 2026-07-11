import { getDashboardData, parseDashboardOptions } from "@/lib/dashboard";
import type { DashboardError } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const options = parseDashboardOptions(new URL(request.url));
  try {
    const data = await getDashboardData(options);
    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const body: DashboardError = {
      error: "Dashboard data is temporarily unavailable.",
      warnings: [String(error)]
    };
    return Response.json(body, {
      status: 503,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }
}
