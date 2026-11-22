# 画面のスクリーンショット

## スライド・README 用（11/22、番号つきのもの）

1600×900（ブラウザの拡大 125% と同じ見え方）。撮り直すときは `scripts/take_screenshots.mjs` の先頭の手順で、試し用のサーバー（3000・3100 以外のポート・偽の API・一時フォルダ・本番用のビルド）を立てて撮る。本物の API は使わない。
05 のほかは `?mock`（保存済みの結果）で撮っているので、画面の上に「（モック）」と出る。

| ファイル | 画面 |
|---|---|
| 01_inbox_x_conversation_reading | 受信箱：X の会話を貼ったあとの読み取り（読めた項目と、たたまれた「未定 9件」） |
| 02_candidates_first_talk_reason_notes | 候補：初登壇の印・理由・注意点・忙しさ・根拠のリンク |
| 03a_outreach_draft | 声かけ文の下書き |
| 03b_organizer_reply_with_questions | 主催者への返事の下書き（日程・持ち時間・テーマの聞き返しつき） |
| 04_request_trace_timeline | 「この依頼の記録」の時間の線（見出しの金額は撮るときに伏せている） |
| 05_not_a_request_stopped | 依頼ではない文を貼って止まったところ（偽の API のサーバーで撮影） |
| 06a_archive_survey_complaints_next_themes | アーカイブ：アンケートの改善点（原文）と次に聞きたいテーマ |
| 06b_archive_casual_interview | アーカイブ：カジュアル面談の希望（人数・登壇ごと・行番号と、登壇者へ伝える文） |
| 07a_notebook_people | ネタ帳：人の一覧（切り替え・検索・絞り込み）と、開いた人のネタ・ブログ・最近の活動 |
| 07b_notebook_survey_voices | ネタ帳：アンケートの声（次に聞きたい話と、話せそうな人） |

## 前の画面（引き算の前）

`http://localhost:3000/?mock` で撮影（モックモード）。引き算の前の画面なので、今の画面は before_after/ の after-*.png を見てください。モックモードでは API を呼ばず、data/ にも書き込みません。

- カード・依頼・状態は data/ の JSON を GET で読む
- Agent の提案は、評価で保存した実際の結果（docs/eval_after.json → app/_client/proposals.json）を再生する
- 「依頼文を貼る」で出した依頼は、候補なしの画面を見せるために必ず「見つからない」を返す
- カードの修正・テーマ案の採用/却下・結果の記録はメモリの中だけで反映する

| ファイル | 画面 |
|---|---|
| desktop-01-main | メイン（ネタ帳と依頼パネル） |
| desktop-02-main-running | 処理中（作業ログが増えていく） |
| desktop-03-main-candidates | 候補3人（自信のある候補と条件付きの候補） |
| desktop-04-named-request-alternative | 指名の依頼：代わりの提案と、推す理由 |
| desktop-04b-conditional-and-partial-no-fit | 条件付きの候補だけ＋「ほかに見つからなかった理由」 |
| desktop-05-approved-draft | 承認後：声かけ文（コピーのみ）とLT構成案 |
| desktop-06-outcome-decline-reason | 結果の記録：辞退の理由を選ぶ |
| desktop-07-outcome-recorded | 結果の記録：書き戻し済み |
| desktop-08-card-detail | カード詳細：新しいテーマ案（未確認）の採用/却下 |
| desktop-09-card-edit | カード詳細：人が直す |
| desktop-10-card-pending-adopted | テーマ案を採用したあと |
| desktop-11-card-detail-from-evidence | 候補の根拠リンクから開いたカード（その投稿を開いた状態） |
| desktop-12-history | 依頼の履歴 |
| desktop-13-learnings | Agentの学び |
| desktop-14-no-fit | 候補がいないとき |
| desktop-15-notebook-update-and-blog | ネタ帳の更新ログとブログのネタ |
| mobile-01〜04 | 幅390pxで縦に積んだ表示 |
