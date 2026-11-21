// API を使う操作（候補を出す・ネタ帳の更新・分析・取り込み・下書き・出し先・ブログのネタ・受信箱への追加）の同時実行の上限。
// 既定は2件（.env の API_MAX_CONCURRENT で変えられる）。空いていなければ、すぐには断らず最大60秒（API_SLOT_WAIT_MS）待ち、
// 届いた順に始める。60秒たっても空かなければ 429 を返し、画面に理由を出す。
// 同じサーバーの中だけで数える（発表用と見せる用は別々のサーバーなので、それぞれ2件まで）。
type Waiter = { grant: (release: () => void) => void };
type Slots = { busy: number; waiters?: Waiter[] };
const g = globalThis as typeof globalThis & { __apiSlots?: Slots };
const slots = () => {
  const s = (g.__apiSlots ??= { busy: 0 });
  s.waiters ??= [];
  return s as Required<Slots>;
};

export function maxApiSlots(): number {
  const n = Number((process.env.API_MAX_CONCURRENT ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 2;
}
/** 空きを待つ長さの上限（ミリ秒）。既定は60秒 */
export function apiSlotWaitMs(): number {
  const n = Number((process.env.API_SLOT_WAIT_MS ?? "").trim());
  return Number.isFinite(n) && n >= 0 && (process.env.API_SLOT_WAIT_MS ?? "").trim() !== "" ? n : 60_000;
}
export const busyApiSlots = () => slots().busy;
export const waitingApiSlots = () => slots().waiters.length;

/** 1件分を返す関数（何度呼んでも1回だけ返す）。待っている人がいれば、数を減らさずにその人へ渡す */
function releaser(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const s = slots();
    const next = s.waiters.shift();
    if (next) next.grant(releaser());
    else s.busy = Math.max(0, s.busy - 1);
  };
}

/** 空きがあれば1件分を取り、返す関数で返す。空きがない（または先に待っている人がいる）なら null（待たない） */
export function acquireApiSlot(): (() => void) | null {
  const s = slots();
  if (s.busy >= maxApiSlots() || s.waiters.length) return null;
  s.busy++;
  return releaser();
}

/**
 * 空きを最大 waitMs 待って1件分を取る。空いていればすぐ返る（ふつうの依頼の所要時間は変わらない）。
 * 待っても空かなければ null。signal が切れた（画面を閉じた）ら、待つのをやめて null
 */
export function acquireApiSlotWait(signal?: AbortSignal | null, waitMs = apiSlotWaitMs()): Promise<(() => void) | null> {
  const now = acquireApiSlot();
  if (now) return Promise.resolve(now);
  if (waitMs <= 0 || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const s = slots();
    let done = false;
    const finish = (r: (() => void) | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const i = s.waiters.indexOf(w);
      if (i >= 0) s.waiters.splice(i, 1);
      resolve(r);
    };
    const w: Waiter = {
      grant: (release) => {
        if (done) release(); // 間に合わなかった（念のため）：次へ回す
        else finish(release);
      },
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), waitMs);
    signal?.addEventListener("abort", onAbort);
    s.waiters.push(w);
  });
}

export const apiBusyResponse = () =>
  Response.json(
    {
      error: `API を使う操作が同時に${maxApiSlots()}件動いていて、${Math.round(apiSlotWaitMs() / 1000)}秒待っても空かなかったので、受け付けませんでした。少し待ってから、もう一度押してください`,
    },
    { status: 429 },
  );

/** 窓口の処理を、空きがあるときだけ動かす（空いていなければ最大60秒待つ）。作業ログを流す応答（NDJSON）は、流し終わるか切れるまで1件分を持つ */
export async function withApiSlot(fn: () => Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  const release = await acquireApiSlotWait(signal);
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
  // 1つ目の引数がリクエストなら、画面を閉じた（切れた）ときに待つのをやめる
  return (...args: A) => withApiSlot(() => fn(...args), args[0] instanceof Request ? args[0].signal : null);
}
