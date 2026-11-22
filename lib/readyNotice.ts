// 受信箱の依頼の候補づくりが終わったことを、ほかの画面にいても分かるようにする知らせ（画面の端の小さな知らせ・タブの題名の件数）。
// - 決めるのはコード：一覧の前回と今回を比べて「準備中 → 終わった」依頼を見つけ、種類ごとの決まった文にする
// - 画面（app/page.tsx）と API なしのテストの両方から使うので、ファイル・データ・API は読まない純粋な関数だけにする
// - ブラウザの通知（許可を求めるもの）は使わない

/** 一覧の1件のうち、知らせに使う項目（lib/board.ts の BoardListItem の一部） */
export interface NoticeSource {
  id: string;
  status: "new" | "processing" | "ready" | "error";
  title: string;
  is_new?: boolean;
  no_fit?: boolean;
  kind?: "request" | "not_request" | "inappropriate";
}

export type NoticeKind = "ready" | "no_fit" | "not_request" | "stopped" | "error";

/** 画面の端に出す知らせ1つ */
export interface ReadyNotice {
  /** 依頼の id（「開く」で開く。同じ依頼の知らせは1つだけ） */
  id: string;
  kind: NoticeKind;
  text: string;
}

/** 知らせに出すイベント名の長さ（これより長ければ「…」で切る） */
export const NOTICE_NAME_MAX = 28;
/** 同時に出す知らせの数（古いものから消す） */
export const NOTICE_MAX = 3;
/** 知らせが自動で消えるまで（ms） */
export const NOTICE_MS = 12_000;
/** タブの題名のもと（app/layout.tsx と同じ） */
export const BASE_TITLE = "ネタ帳Agent";

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * 知らせに出す名前：一覧の題名（会話から読めたイベント名、なければ本文の先頭）。空なら「新しい依頼」。
 * 題名が本文の先頭のままで、「イベント名」のかっこで始まっているときは、かっこの中だけを出す（「Mock Night」運営です。… → Mock Night）
 */
export function noticeName(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return "新しい依頼";
  const quoted = t.match(/^「([^「」]{2,40})」(?=.)/);
  return cut(quoted ? quoted[1] : t, NOTICE_NAME_MAX);
}

/** 終わった依頼1件の知らせ（決まった文）。準備中・まだ始めていない依頼は null */
export function noticeFor(it: NoticeSource): ReadyNotice | null {
  if (it.status === "processing" || it.status === "new") return null;
  const name = noticeName(it.title);
  if (it.status === "error") return { id: it.id, kind: "error", text: `${name}の候補づくりに失敗しました` };
  if (it.kind === "not_request") return { id: it.id, kind: "not_request", text: `${name}は依頼ではなさそうです` };
  if (it.kind === "inappropriate") return { id: it.id, kind: "stopped", text: `${name}は止めました` };
  if (it.no_fit) return { id: it.id, kind: "no_fit", text: `${name}の準備が終わりました（合う候補は見つかりませんでした）` };
  return { id: it.id, kind: "ready", text: `${name}の候補を準備できました` };
}

/**
 * 前回の一覧では準備中で、今回は終わっている依頼の知らせ。
 * - prev：前回の一覧の、依頼ごとの状態（最初の読み込みでは空。最初から終わっていた依頼は知らせない）
 * - openId：今、画面で開いている依頼（受信箱タブで開いているもの）。その依頼は知らせない
 */
export function finishedNotices(prev: ReadonlyMap<string, NoticeSource["status"]>, items: NoticeSource[], openId: string | null): ReadyNotice[] {
  return items
    .filter((it) => prev.get(it.id) === "processing" && it.status !== "processing" && it.id !== openId)
    .map(noticeFor)
    .filter((n): n is ReadyNotice => n !== null);
}

/** 今回の一覧の、依頼ごとの状態（次の回の prev にする） */
export const statusMap = (items: NoticeSource[]): Map<string, NoticeSource["status"]> => new Map(items.map((it) => [it.id, it.status]));

/** 知らせを足す：同じ依頼の古い知らせは置き換え、多すぎたら古いものから消す */
export function addNotices(current: ReadyNotice[], added: ReadyNotice[]): ReadyNotice[] {
  if (!added.length) return current;
  const ids = new Set(added.map((n) => n.id));
  return [...current.filter((n) => !ids.has(n.id)), ...added].slice(-NOTICE_MAX);
}

/**
 * まだ開いていない準備済みの依頼の数（タブの題名に出す）。今開いている依頼は数えない。
 * - 一覧の「新しい」印（まだ一度も開いていない）が付いた準備済みの依頼
 * - unseen：準備中に一度開いたが、終わったあとの結果をまだ見ていない依頼（貼ってすぐ別のタブに移ったとき）
 */
export function unopenedReadyCount(items: NoticeSource[], openId: string | null, unseen: readonly string[] = []): number {
  return items.filter((it) => it.id !== openId && it.status !== "processing" && ((it.status === "ready" && it.is_new === true) || unseen.includes(it.id))).length;
}

/** タブの題名：「(1) ネタ帳Agent」。0件なら「ネタ帳Agent」 */
export const pageTitle = (count: number): string => (count > 0 ? `(${count > 99 ? "99+" : count}) ${BASE_TITLE}` : BASE_TITLE);
