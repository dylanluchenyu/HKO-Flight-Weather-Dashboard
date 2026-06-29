import { getDashboardData, parseDashboardOptions } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const options = parseDashboardOptions(new URL(request.url));
  const data = await getDashboardData(options);

  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
