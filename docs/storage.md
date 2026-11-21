# 保存の入口の一覧（2026-11-22 時点）

どのファイルを、どの関数が読み書きしているかの表です。JSON の読み書きを1つにまとめるとき（docs/roadmap.md の1）と、DB に移すとき（同3）の作業表として使います。
行番号は main（75e0de4）＋ feature/maintain の時点です。コードを動かしたら、この表も直してください（確かめ方は一番下）。

## 1. 置き場所は3種類

| 種類 | 場所 | git | 書くか |
| --- | --- | --- | --- |
| 元のデータ | `data/*.json`、`data/sources/…`、`data/surveys/*.csv` | 入る | アプリは書かない（読むだけ）。作るのは `scripts/gen_data.py`・`scripts/import_github.ts`・`scripts/slack/sources.ts` |
| 実行時のデータ（元に重ねる） | `data/runtime/`（`DATA_RUNTIME_DIR` で変えられる。`DATA_SOURCE=github` などのときは `data/runtime/<切り替えの名前>/`） | 入らない | 画面の操作・ネタ帳の更新の結果。読むときは元のデータに重ねる（`lib/runtime.ts`） |
| 実行時のデータ（単独のファイル） | `data/inbox.json`・`data/sample_proposals.json`・`data/drafts.json`・`data/usage.json`・`data/survey_analysis.json`・`data/talk_records.json`・`data/survey_imports/` | 入らない | 受信箱・下書き・金額・アンケートの結果。元のデータがないもの |

`npm run reset:demo` は、2つ目と3つ目のうち金額とアンケートの分析以外を `data/runtime-backup/<日時>/` に移します（`scripts/reset_demo.ts`）。

## 2. 読み書きの関数が散らばっている場所（まとめる対象）

同じ「JSON を読む・書く」が、次の8か所に別々にあります。

| ファイル | 行 | 中身 |
| --- | --- | --- |
| `lib/runtime.ts` | 21・25 | `readJsonFile`・`writeJsonFile`（中身が同じなら書かない）。重ねる読み書き（`readOverlay`・`writeOverlay`・`readReplaced`・`writeReplaced`・`writeCardOverlay`）の土台 |
| `lib/data.ts` | 26・33 | `readJson`・`writeJson`。読んでよいファイル名の一覧（`ALLOWED`）つき。金額の記録だけ書く（183行 `appendUsage`） |
| `lib/board.ts` | 22・30 | `readJson`・`writeJson`（サンプルの依頼の候補・下書き） |
| `lib/moreSources.ts` | 46 | `readJson`（ブログ・Slack の投稿。読むだけ） |
| `lib/releaseNotes.ts` | 68・71 | `readJson`・`writeJson`（担当者の割り当て・担当者未定のネタ） |
| `lib/inbox.ts` | `load`・`save`・`update` | 受信箱。直接 `fs` を呼ぶ |
| `lib/surveys.ts` | 31・581 付近 | アンケートの分析結果・登壇者の記録。直接 `fs` を呼ぶ（6か所） |
| `scripts/slack/sources.ts` | 51・52 | `readJson`・`writeJson`（Slack から読んだ投稿と読んだ位置） |

どれも「全部読む → 直す → 全部書く」で、書き込みは直接の上書きです（一時ファイルに書いて置き換える形ではない。書いている途中で落ちるとファイルが壊れる）。

## 3. ファイルごとの入口

| データ | ファイル | 重ね方 | 書く関数（入口） | id の作り方 |
| --- | --- | --- | --- | --- |
| カード（ネタ帳） | 元：`data/cards.json`（＋`data/sources/demo-person/cards.json`）／実行時：`data/runtime/cards.json` | 変わったカードだけを重ねる（`lib/runtime.ts` 76行 `writeCardOverlay`） | `lib/cards.ts`：`upsertCard`（265行）・`editCard`（383行）・`resolvePendingTheme`（361行）・`appendOutreach`（432行）・`removeOutreach`（443行）・`patchCard`（146行。アンケートの書き戻し用） | `card-<社員id>-<連番2桁>`。その人のカードの枚数から決める（`nextCardId` 161行） |
| 担当者未定のネタ | 元：`data/unassigned_cards.json`／実行時：同名 | 丸ごと置き換え（`readReplaced`・`writeReplaced`） | `lib/releaseCards.ts`：`saveReleaseItems`（188行）・`assignUnassigned`（349行） | `card-team-<連番2桁>`（183行） |
| リリースの担当者の割り当て | 元：`data/release_owners.json`／実行時：同名 | キーごとの差分（`readOverlay`・`writeOverlay`） | `lib/releaseNotes.ts`（84行）。呼ぶのは `lib/releaseCards.ts` | リリースノートの id（`rel001`）がキー |
| ネタ帳の更新の状態 | `notebook_state.json`（社員 id → 日付） | キーごとの差分 | `lib/notebook.ts`（33行） | 社員 id がキー |
| ネタ帳の更新で読んだ記録 | `notebook_progress.json`（社員 id → 読んだ活動の id） | キーごとの差分 | `lib/notebookPrep.ts`：`saveProgress`（172行） | 社員 id がキー |
| 人の情報（得意分野・意向・NGのテーマ） | `data/runtime/people.json`（元のデータはなし。社員データに重ねる） | 単独 | `lib/people.ts`：`editPerson`（102行） | 社員 id がキー |
| 受信箱 | `data/inbox.json` | 単独 | `lib/inbox.ts`：`registerInbox`（236行）・`markOpened`（120行）・`prepare`・`restart`（中の `update`） | `inb-<時刻36進>-<乱数6桁>`（226行） |
| サンプルの依頼の候補 | `data/sample_proposals.json` | 単独 | `lib/board.ts`：`saveSampleProposal`（48行）・`markSampleOpened`（55行） | 依頼 id（`req001`）がキー |
| 下書き（声かけ文・主催者への返事） | `data/drafts.json` | 単独 | `lib/board.ts`：`saveDraft`（65行） | `<依頼id>:<社員id>` |
| 金額の記録 | `data/usage.json` | 単独（追記） | `lib/data.ts`：`appendUsage`（183行）。呼ぶのは `lib/usage.ts` の `recordUsage`（12行） | なし（1回の呼び出しが1行。実行の id は `randomUUID`） |
| アンケートの取り込み | `data/survey_imports/<イベントid>.json` | 単独 | `lib/surveyCsv.ts`：`saveImport`（267行） | 回答 id は `<イベントid>-r<CSVの行番号>` |
| アンケートの分析結果 | `data/survey_analysis.json`（なければ `docs/survey_latest.json` の保存済みの結果で補う） | 単独 | `lib/surveys.ts`（`saveAnalysis`） | イベント id がキー |
| 登壇者の記録（内部） | `data/talk_records.json` | 単独 | `lib/surveys.ts`：`writeBack`（594行）の中 | `<イベントid>` と社員 id |
| 社員・活動・イベント・依頼・発信・予定・外部イベント | `data/*.json`、`data/sources/…` | 読むだけ（`DATA_SOURCE`・`DEMO_PERSON`・`MORE_SOURCES`・`RELEASE_NOTES` で材料が変わる） | アプリからは書かない | 活動：`act001`（架空は決め打ち、GitHub は並び順 `scripts/import_github.ts` 295行、デモ用の本人は +200 `lib/demoPerson.ts` 37行）、Slack：`slk<連番3桁>`（`scripts/slack/sources.ts` 140行） |

テスト用に、ファイルの場所を環境変数で差し替える入口が本番のコードに入っています：`INBOX_FILE`・`SAMPLE_PROPOSALS_FILE`・`DRAFTS_FILE`・`USAGE_FILE`・`PEOPLE_FILE`・`RELEASE_OWNERS_FILE`・`UNASSIGNED_CARDS_FILE`・`SLACK_POSTS_FILE`・`SURVEY_ANALYSIS_FILE`・`SURVEY_IMPORT_DIR`・`TALK_RECORD_FILE`・`DATA_RUNTIME_DIR`。保存の入口を1つにしたら、差し替えは1か所（置き場所を1つ渡す）で済みます。

## 4. id の作り方で困るところ

| id | 今の作り方 | 困ること |
| --- | --- | --- |
| カード `card-e012-01` | その人のカードの枚数＋1（空いている番号まで進める） | 同時に2枚作ると同じ id になる。カードを消すと番号が使い回される |
| 担当者未定のネタ `card-team-01` | 一覧の件数から | 同じ |
| Slack の投稿 `slk001` | 保存済みの最大の番号＋1 | 2つの取り込みが同時に走ると重なる |
| GitHub の活動 `act001` | 日付とタイトルで並べた順 | 取り込み直すと番号がずれ、カードの根拠が別の活動を指す（検査は通ってしまう） |
| 社員 `e001` | 元のデータの決め打ち。`e` ＋数字3桁の形を検査（`lib/plainText.ts` の「社員のid」）と画面が前提にしている | 1,000人以上・別の形の id の会社で、内部の言葉の検査が効かない |
| 受信箱 `inb-…`、実行 `randomUUID` | 時刻＋乱数、UUID | 問題なし（この形にそろえる） |

## 5. 2つ以上の書き込みが組になっているところ（まとめて成功・失敗させる仕組みがない）

| 操作 | 書き込みの順 | 途中で止まると |
| --- | --- | --- |
| 結果の記録（カードのない候補の承認） `app/api/outcome/route.ts` | `upsertCard`（カードを作る）→ `appendOutreach`（打診を足す） | カードだけできて、打診が残らない |
| 担当者の割り当て `lib/releaseCards.ts` `assignUnassigned` | 担当者の記録 → カードを作る（作れなければ担当者の記録を元に戻す）→ 確認済みにする（`editCard`）→ 担当者未定の一覧から外す | カードを作ったあとで止まると、一覧に残ったまま、カードと割り当てだけ残る |
| ネタ帳の更新 `lib/notebook.ts` `updateNotebook` | カードの保存（1枚ずつ）→ 読んだ記録 → 更新の状態 | カードは保存済みで、読んだ記録がない（次回もう一度読む。重複の検査で差し戻される） |
| アンケートの分析 `lib/surveys.ts` `analyzeEvent` | カードへの書き戻し・登壇者の記録 → 分析結果の保存 | カードだけ変わって、分析結果がない |
| 受信箱の準備 `lib/inbox.ts` `prepare` | 読み取りの保存 → 候補の保存 → 代わりの人を推す文の保存 | 「準備中」のまま残り、15分後にエラー扱い |
| リリースをカードに `lib/releaseCards.ts` `saveReleaseItems` | カードを1枚ずつ → 担当者の記録 → 担当者未定の一覧 | 何枚か保存した途中で止まる |

## 6. この表の確かめ方

```bash
grep -rnE "^function (readJson|writeJson)|^const (readJson|writeJson)|export function (readJsonFile|writeIfChanged)" lib scripts
```

```bash
grep -rnE "process\.env\.[A-Z_]*(FILE|DIR)" lib
```

```bash
grep -nE "^export (async )?function (save|append|register|mark|patch|upsert|edit|resolve|remove|assign|record)[A-Za-z]*" lib/*.ts
```

1つ目で2の表、2つ目で3の表の下の差し替えの一覧、3つ目で3の表の「書く関数」と合うことを見ます。
