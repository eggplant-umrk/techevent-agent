import { requests } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(requests());
}
