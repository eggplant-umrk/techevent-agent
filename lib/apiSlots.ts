// API を使う操作（候補を出す・ネタ帳の更新・分析・取り込み・下書き・出し先・ブログのネタ・受信箱への追加）の同時実行の上限。
// 既定は2件（.env の API_MAX_CONCURRENT で変えられる）。超えたら 429 を返し、画面に理由を出す。
// 同じサーバーの中だけで数える（発表用と見せる用は別々のサーバーなので、それぞれ2件まで）。
type Slots = { busy: number };
const g = globalThis as typeof globalThis & { __apiSlots?: Slots };
const slots = () => (g.__apiSlots ??= { busy: 0 });

export function maxApiSlots(): number {
  const n = Number((process.env.API_MAX_CONCURRENT ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 2;
}
export const busyApiSlots = () => slots().busy;

/** 空きがあれば1件分を取り、返す関数で返す（何度呼んでも1回だけ返す）。空きがなければ null */
export function acquireApiSlot(): (() => void) | null {
  const s = slots();
  if (s.busy >= maxApiSlots()) return null;
  s.busy++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.busy = Math.max(0, s.busy - 1);
  };
}

export const apiBusyResponse = () =>
  Response.json(
    { error: `API を使う操作が同時に${maxApiSlots()}件動いているので、受け付けませんでした。少し待ってから、もう一度押してください` },
    { status: 429 },
  );

/** 窓口の処理を、空きがあるときだけ動かす。作業ログを流す応答（NDJSON）は、流し終わるか切れるまで1件分を持つ */
export async function withApiSlot(fn: () => Promise<Response>): Promise<Response> {
  const release = acquireApiSlot();
  if (!release) return apiBusyResponse();
  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    release();
    throw e;
  }
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    release();
    return res;
  }
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else controller.enqueue(value);
      } catch (e) {
        release();
        controller.error(e);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, headers: res.headers });
}

/** 窓口の POST を withApiSlot で包む */
export function slotted<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return (...args: A) => withApiSlot(() => fn(...args));
}
