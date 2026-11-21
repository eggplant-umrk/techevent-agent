// カード → 出し先：本人への声かけ文の下書き（送らない）。イベントの情報はサーバー側のデータから引き直す
import { getCardById } from "@/lib/cards";
import { deadlineDate, externalEventById, isClosed, requiredCautions } from "@/lib/externalEvents";
import { draftVenueOutreach } from "@/lib/heavy";
import { runUsd, totalUsd } from "@/lib/usage";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  run_id: string;
  card_id: string;
  event_id: string;
  theme: string;
  reason: string;
  cautions?: string[];
}

async function handlePost(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  const card = b?.card_id ? getCardById(b.card_id) : undefined;
  const ev = b?.event_id ? externalEventById(b.event_id) : undefined;
  if (!b || !card || !ev) return Response.json({ error: "カードまたは出し先が見つかりません" }, { status: 400 });
  if (isClosed(ev)) return Response.json({ error: `${ev.name} は締切済みです` }, { status: 400 });
  try {
    const cautions = [...new Set([...(b.cautions ?? []), ...requiredCautions(ev, card.employee_id)])];
    const r = await draftVenueOutreach(b.run_id || `venue-${card.card_id}`, card, {
      name: ev.name,
      event_date: ev.event_date,
      cfp_status: ev.cfp_status,
      cfp_deadline: deadlineDate(ev),
      format: ev.format,
      location: ev.location,
      theme: String(b.theme ?? "").slice(0, 300),
      reason: String(b.reason ?? "").slice(0, 600),
      cautions,
    });
    return Response.json({ draft: r.value, model: r.model, fell_back: r.fellBack, run_usd: runUsd(b.run_id), total_usd: totalUsd() });
  } catch (err) {
    return Response.json({ error: userErrorText(err, { where: "出し先の下書き" }) }, { status: 500 });
  }
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
