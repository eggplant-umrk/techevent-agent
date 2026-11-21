# 画面のスクリーンショット

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
