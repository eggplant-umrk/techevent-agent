// API を使う操作（候補を出す・ネタ帳の更新・分析・取り込み・下書き・出し先・ブログのネタ・受信箱への追加）の同時実行の上限。
// 発表用：全体で2件（.env の API_MAX_CONCURRENT で変えられる）。
// 見せる用（SHARE_MODE=lan）：1人1件まで・全体で6件まで（SHARE_API_PER_PERSON・SHARE_API_MAX_CONCURRENT で変えられる）。
//   人は lib/visitorScope.ts の今の人（人の印 nb_person）。印のない要求（合言葉のヘッダーだけ）は、まとめて1人として数える。
// 空いていなければ、すぐには断らず最大60秒（API_SLOT_WAIT_MS）待ち、届いた順に始める（ほかの人の待ちには割り込まない。
// 自分の1件が動いているだけの人は、ほかの人を止めない）。60秒たっても空かなければ 429 を返し、画面に理由を出す。
// 同じサーバーの中だけで数える（発表用と見せる用は別々のサーバーなので、それぞれで数える）。
// 金額の記録（data/usage.json）が読めない間は、API を使う操作を始めず「金額の記録が読めません」と返す（503。lib/usageFile.ts）。
import { usageProblem } from "./usageFile";
import { currentVisitorKey, visitorsOn } from "./visitorScope";
type Waiter = { person: string | null; grant: (release: () => void) => void };
type Slots = { busy: number; waiters?: Waiter[]; byPerson?: Record<string, number> };
const g = globalThis as typeof globalThis & { __apiSlots?: Slots };
const slots = () => {
  const s = (g.__apiSlots ??= { busy: 0 });
  s.waiters ??= [];
  s.byPerson ??= {};
  return s as Required<Slots>;
};

const posInt = (name: string, fallback: number) => {
  const n = Number((process.env[name] ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
/** 全体の上限。発表用は API_MAX_CONCURRENT（既定2）、見せる用は SHARE_API_MAX_CONCURRENT（既定6） */
export function maxApiSlots(): number {
  return visitorsOn() ? posInt("SHARE_API_MAX_CONCURRENT", 6) : posInt("API_MAX_CONCURRENT", 2);
}
/** 1人あたりの上限（見せる用だけ。SHARE_API_PER_PERSON、既定1）。発表用は null（人で数えない） */
export function perPersonApiSlots(): number | null {
  return visitorsOn() ? posInt("SHARE_API_PER_PERSON", 1) : null;
}
/** 空きを待つ長さの上限（ミリ秒）。既定は60秒 */
export function apiSlotWaitMs(): number {
  const n = Number((process.env.API_SLOT_WAIT_MS ?? "").trim());
  return Number.isFinite(n) && n >= 0 && (process.env.API_SLOT_WAIT_MS ?? "").trim() !== "" ? n : 60_000;
}
export const busyApiSlots = () => slots().busy;
export const waitingApiSlots = () => slots().waiters.length;
/** その人が今持っている件数（見せる用。テストと理由の文に使う） */
export const busyApiSlotsOf = (person: string) => slots().byPerson[person] ?? 0;

/** 数える人（見せる用だけ。発表用は null） */
const personNow = (): string | null => (perPersonApiSlots() === null ? null : currentVisitorKey());

function canTake(person: string | null): boolean {
  const s = slots();
  if (s.busy >= maxApiSlots()) return false;
  const per = perPersonApiSlots();
  return person === null || per === null || (s.byPerson[person] ?? 0) < per;
}
function take(person: string | null): () => void {
  const s = slots();
  s.busy++;
  if (person !== null) s.byPerson[person] = (s.byPerson[person] ?? 0) + 1;
  return releaser(person);
}

/** 1件分を返す関数（何度呼んでも1回だけ返す）。返したら、待っている人のうち始められる人に届いた順に渡す */
function releaser(person: string | null): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const s = slots();
    s.busy = Math.max(0, s.busy - 1);
    if (person !== null) {
      const n = (s.byPerson[person] ?? 0) - 1;
      if (n > 0) s.byPerson[person] = n;
      else delete s.byPerson[person];
    }
    for (const w of [...s.waiters]) {
      if (!canTake(w.person)) continue;
      s.waiters.splice(s.waiters.indexOf(w), 1);
      w.grant(take(w.person));
    }
  };
}

/** 先に待っている人がいて、その人が今始められるか（始められる人がいるなら、あとから来た人は割り込まない） */
const someoneAheadCanStart = () => slots().waiters.some((w) => canTake(w.person));

/** 空きがあれば1件分を取り、返す関数で返す。空きがない（または先に待っている人が始められる）なら null（待たない） */
export function acquireApiSlot(): (() => void) | null {
  if (usageProblem()) return null; // 金額の記録が読めない間は、API を使う操作を始めない（apiBusyResponse が理由を出す）
  const person = personNow();
  const s = slots();
  // 発表用は今までどおり、待っている人がいれば取らない。見せる用は、待っている人が今始められないとき（その人の1件が動いている）だけ先に取れる
  if (!canTake(person) || (perPersonApiSlots() === null ? s.waiters.length > 0 : someoneAheadCanStart())) return null;
  return take(person);
}

/**
 * 空きを最大 waitMs 待って1件分を取る。空いていればすぐ返る（ふつうの依頼の所要時間は変わらない）。
 * 待っても空かなければ null。signal が切れた（画面を閉じた）ら、待つのをやめて null
 */
export function acquireApiSlotWait(signal?: AbortSignal | null, waitMs = apiSlotWaitMs()): Promise<(() => void) | null> {
  const now = acquireApiSlot();
  if (now) return Promise.resolve(now);
  if (waitMs <= 0 || signal?.aborted || usageProblem()) return Promise.resolve(null);
  const person = personNow();
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
      person,
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

export const apiBusyResponse = () => {
  const problem = usageProblem();
  if (problem) return Response.json({ error: problem }, { status: 503 });
  const wait = Math.round(apiSlotWaitMs() / 1000);
  const per = perPersonApiSlots();
  const person = personNow();
  if (per !== null && person !== null && busyApiSlotsOf(person) >= per) {
    return Response.json(
      { error: `この端末の API を使う操作がもう${per}件動いていて、${wait}秒待っても終わらなかったので、受け付けませんでした。前の操作が終わってから、もう一度押してください` },
      { status: 429 },
    );
  }
  return Response.json(
    {
      error: `API を使う操作が同時に${maxApiSlots()}件動いていて、${wait}秒待っても空かなかったので、受け付けませんでした。少し待ってから、もう一度押してください`,
    },
    { status: 429 },
  );
};

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

/**
 * 枠を取ったあと、裏で続く処理に枠を渡す窓口用（受信箱への追加・依頼として進める・もう一度探す）。
 * fn は release を受け取り、裏の処理が終わったら返す。fn が投げたら（保存の失敗など）、ここで必ず返す
 */
export async function withApiSlotHandoff(signal: AbortSignal | null | undefined, fn: (release: () => void) => Response | Promise<Response>): Promise<Response> {
  const release = await acquireApiSlotWait(signal);
  if (!release) return apiBusyResponse();
  try {
    return await fn(release);
  } catch (e) {
    release();
    throw e;
  }
}

/** 窓口の POST を withApiSlot で包む */
export function slotted<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  // 1つ目の引数がリクエストなら、画面を閉じた（切れた）ときに待つのをやめる
  return (...args: A) => withApiSlot(() => fn(...args), args[0] instanceof Request ? args[0].signal : null);
}
