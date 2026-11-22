// アンケートの「カジュアル面談の希望」（v0.4）。AI は使わず、すべてコードで決める。
// - 列の見分け方：質問文に「カジュアル面談」「面談」「話を聞いてみたい」「採用」などがある列（lib/surveyCsv.ts の KEYWORDS から使う）
// - 値は はい／いいえ に読み替える。どちらとも読めない値（空欄など）は数えない
// - 残すのは、イベントごとの希望の人数・希望した回答の行番号・登壇ごとの人数だけ。名前・メール・連絡先は残さない（その列は取り込み時に捨てている）
// - 登壇者へ伝える文の下書きもコードで作る。送信はしない（画面で編集とコピーだけ）
// 画面（ブラウザ）からも読むので、fs などのサーバー専用のものは import しない。

/** 面談の希望を聞いている質問文 */
export const INTERVIEW_HEADER = /カジュアル面談|面談|話を聞いてみたい|話を聞いてみたく|採用/;

/** 回答の値を はい／いいえ に読み替える。読めなければ null（数えない） */
export function interviewAnswer(value: string): "yes" | "no" | null {
  const v = (value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!v) return null;
  // 「希望しない」「今はいい」などの否定を先に見る（「希望」を含むため）
  if (/いいえ|^no\b|^n$|しない|ません|不要|結構|遠慮|なし|無し|今は(いい|大丈夫)|^×$|^✕$/.test(v)) return "no";
  if (/^(はい|yes|y|ok|ぜひ|是非|希望|する|します|あり|有り|興味あり|聞いてみたい|話してみたい|お願いします)|^○$|^〇$|^◯$|希望する|希望します/.test(v)) return "yes";
  return null;
}

/** 保存する形（lib/surveyCsv.ts の SurveyImport.casual_interview） */
export interface CasualInterview {
  /** 面談の希望の列の質問文 */
  header: string;
  /** 希望した人の合計 */
  total: number;
  /** 希望した回答の、元のスプレッドシートの行番号（回答 id の ev019-r12 なら 12）。小さい順 */
  rows: number[];
  /** 登壇ごとの希望の人数（登壇者 id → 人数）。どの登壇か分からない回答は合計にだけ入る */
  by_talk: Record<string, number>;
}

/** 回答 id（例：ev019-r12）から行番号（12）を取り出す */
export function rowOfAnswerId(id: string): number | null {
  const m = id.match(/-r(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** 「12行目・27行目」 */
export const rowsLabel = (rows: number[]) => rows.map((r) => `${r}行目`).join("・");

/** 登壇者へ伝える文の下書き。入れるのは登壇者の名前・イベント名・人数だけ（希望した方の名前や連絡先は持っていないので入らない） */
export function interviewDraft(input: { speakerName: string; eventTitle: string; count: number }): string {
  const name = input.speakerName.trim().split(/\s+/)[0] || input.speakerName.trim();
  return `${name}さん、${input.eventTitle}でのご登壇ありがとうございました。聞いてくださった方のうち${input.count}人が、カジュアル面談を希望しています。詳しくは技術広報から連絡します。`;
}
