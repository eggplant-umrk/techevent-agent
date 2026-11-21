import { employeeById, learnings } from "@/lib/data";
import { chooseModels } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const models = chooseModels();
  return Response.json({
    models,
    learnings: learnings()
      .slice()
      .reverse()
      .map((l) => ({ ...l, employee_name: employeeById(l.employee_id)?.name ?? l.employee_id })),
  });
}
