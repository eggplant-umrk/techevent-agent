import { pendingEmployees } from "@/lib/notebook";
import { chooseModels } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ models: chooseModels(), pending_employees: pendingEmployees().length });
}
