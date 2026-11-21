# data/

デモ用のダミーデータです。技術スタックに依存しないよう、すべてJSON（UTF-8）で置いています。

**人物・投稿・会社・イベントはすべて架空です。** 実在の社員名や社外の組織名は使っていません。URLはすべて `example.com` です。

| ファイル | 件数 | 内容 |
| --- | --- | --- |
| [employees.json](employees.json) | 30人 | 社員 |
| [activities.json](activities.json) | 120件 | 社内の活動（Slack投稿・GitHubのPR・設計ドキュメント・週報） |
| [events.json](events.json) | 20件 | 過去の社外向けイベント |
| [requests.json](requests.json) | 5件 | 社外から来た登壇の依頼 |
| [application_rules.json](application_rules.json) | 13ルール | イベント開催時に必要な申請 |
| [published.json](published.json) | 40件 | 発信済みの記録（「直近の発信」DBのダミー） |
| [schedules.json](schedules.json) | 14件 | 社員の既知の予定（出張・登壇・リリース対応など） |
| [learnings.json](learnings.json) | 0件〜 | Agentの学び。画面で結果を記録すると追記される |
| `usage.json` | — | APIの使用量と金額の記録。アプリが作る。gitには入れない |

`employees.json`〜`application_rules.json`、`published.json`、`schedules.json` は [scripts/gen_data.py](../scripts/gen_data.py) で作り直せます（`python scripts/gen_data.py`）。検証は `python scripts/validate_data.py` です。

日付はすべて `YYYY-MM-DD` 形式です。データの基準日（「今日」）は **2026-11-21** としています。

---

## employees.json

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | `e001`〜`e030` |
| `name` | string | 氏名（架空） |
| `business_unit` | string | 事業部。`バクラク` / `Ai Workforce` / `Fintech` / `セキュリティ` / `CTO室` |
| `role` | string | 職種 |
| `expertise_tags` | string[] | 得意分野 |
| `past_talk_count` | number | 過去の社外登壇回数 |
| `last_talk_date` | string \| null | 最後に登壇した日。登壇経験がなければ `null` |
| `workload` | number | 業務の忙しさ。1（余裕あり）〜5（とても忙しい） |

登壇は偏らせています。`e001`〜`e005` の5人で全登壇の約92%（55/60回）を占めていて、21人は登壇経験がありません。

## activities.json

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | `act001`〜`act120`（日付順） |
| `type` | string | `slack_post` / `github_pr` / `design_doc` / `weekly_report` |
| `author_id` | string | 書いた人。`employees.json` の `id` |
| `date` | string | 2026-09-01〜2026-11-20 |
| `title` | string | タイトル |
| `body` | string | 本文（2〜4文） |
| `channel` | string \| null | Slackのチャンネル（`slack_post` と `weekly_report`） |
| `repo` | string \| null | リポジトリ（`github_pr` と `design_doc`）。`channel` と `repo` はどちらか一方だけが入る |

内訳は `slack_post` 52件、`github_pr` 32件、`weekly_report` 22件、`design_doc` 14件です。

中身は3種類あります。

- **未発信の取り組み（20件）**：登壇ネタになりそうなのに社外に出ていないもの。書いたのはほぼ登壇経験のない人です。1つの取り組みが複数の活動に分かれていることもあります（例：検索精度の改善は Slack投稿・PR・設計ドキュメントの3件）
- **発信済み（6件）**：よく登壇する人が「登壇しました」「ブログを公開しました」と書いたもの。`#tech-pr` チャンネルが中心です
- **日常のノイズ（94件）**：リリース連絡、CIの失敗、typo修正、普段の週報など

## events.json

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | `ev001`〜`ev020` |
| `title` | string | イベント名 |
| `series` | string | `layerx.go` / `QA Night` / `AIエージェント設計勉強会` / `バクラク Tech Talk` / `Fintech Engineering Meetup` / `共催LT会` |
| `date` / `weekday` | string | 開催日と曜日（2025-01〜2026-10） |
| `start_time` | string | 開始時刻 |
| `venue` / `venue_type` | string | 会場名と種別（`internal`＝自社イベントスペース / `external`＝外部会場） |
| `capacity` | number | 定員 |
| `applications` | number | 申込数 |
| `attendees` | number | 来場数 |
| `attendance_rate` | number | 来場率（来場数÷申込数）。0.6〜0.9でばらつかせている |
| `speaker_ids` | string[] | 登壇した社員の `id` |
| `catering` | object | 飲食の発注実績。`food_servings_ordered`（発注した食事の人数分）、`food_servings_left`（余った人数分）、`drinks_ordered`（発注したドリンク数） |

`catering` は依頼にはない項目ですが、「来場データで発注精度を上げる」デモに使えるように足しました。発注数は勘で決めた想定で、余る回と足りない回（`ev008` など）があります。

## requests.json

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | `req001`〜`req005` |
| `pattern` | string | `open_slot`（枠だけ）/ `theme_specified`（テーマ指定）/ `named_speaker`（特定の人を指名） |
| `received_at` | string | 依頼を受けた日 |
| `requester` | object | 依頼元の組織名・担当・連絡手段（すべて架空） |
| `event` | object | 依頼先のイベント。名前・日付・形式・持ち時間・聴衆・会場・オンラインか |
| `theme` | string \| null | 指定されたテーマ |
| `nominated_employee_id` | string \| null | 指名された社員 |
| `reference` | object \| null | 指名のきっかけになった外部資料 |
| `reply_deadline` | string | 回答期限 |
| `message` | string | 依頼の原文 |
| `note_for_demo` | string | （指名パターンのみ）デモで見せたい論点のメモ。**Agentには渡さない** |

| id | パターン | 内容 |
| --- | --- | --- |
| req001 | 枠だけ | 合同LTナイト、テーマはお任せ |
| req002 | テーマ指定 | AIエージェントの品質評価 |
| req003 | テーマ指定 | 障害対応と振り返り（共催・自社会場の希望つき） |
| req004 | 指名 | フロントエンド性能の話で、よく登壇するEM（`e002`）を指名 |
| req005 | 指名 | 脆弱性管理の自動化で、過去に登壇した `e007` を指名 |

## application_rules.json

`rules` の各ルールは、`applies_when` の条件を**すべて**満たすときに申請が必要になります。条件のキーの意味はファイル内の `condition_keys` に書いてあります。

| フィールド | 説明 |
| --- | --- |
| `name` | 申請名 |
| `applies_when` | 条件（会場種別・曜日・月・期間・想定人数・終了時刻・飲酒・飲食・配信） |
| `reason` | なぜ必要か |
| `submit_to` | 提出先 |
| `deadline_days_before` | 開催日の何日前までに出すか |
| `approver` | 承認者 |
| `blocking` | `true` なら申請ではなく開催不可（年末年始の閉館） |

主なルール：金曜×自社会場はゴミ回収申請、6〜9月×自社会場は空調延長申請、51人以上は警備会社への連絡、101人以上×自社会場は消防署への届出。自社イベントスペースの定員（120人）は `internal_venue` にあります。

## published.json

実物の「直近の発信」DBの項目に合わせています。`e001`〜`e005` で40件中32件（80%）です。

| フィールド | 説明 |
| --- | --- |
| `id` / `title` / `url` | ID・タイトル・URL（すべて `example.com`） |
| `tags` | タグ |
| `author_id` | Author（`employees.json` の `id`） |
| `business_unit` / `team` | 所属事業部・所属チーム |
| `published_at` | 公開日時（ISO 8601、JST） |
| `genre` | 発信ジャンル（メンバーのブログ／インタビュー記事／登壇資料／イベントレポート／Podcast） |
| `target_reader` | こういう方に読んでもらいたい |

## schedules.json

`check_schedule` が見る予定です。`employee_id`・`from`・`to`（両端を含む）・`kind`・`note`。

## learnings.json

画面の「結果の記録」で追記されます。`request_id`・`employee_id`・`result`（`accepted` / `declined`）・`reason`（`theme_mismatch` / `busy` / `schedule_conflict` / `other`）・`note`・`event_date`・`recorded_at`。

---

## デモの正解データ（Agentには渡さないこと）

Agentの出力を確かめるための正解です。このREADMEをAgentの入力に含めると答えが漏れるので注意してください。

### 未発信の取り組み（20件・13テーマ）

| テーマ | 担当 | 活動 |
| --- | --- | --- |
| 検索精度の改善（ハイブリッド検索でnDCG 0.62→0.81） | e011 葛西 | act011, act025, act046 |
| AIエージェントの評価基盤（LLM-as-a-judge、人手評価との一致率87%） | e013 早乙女 | act019, act050, act073 |
| 障害対応の振り返り（月末決済バッチの4時間遅延） | e015 芹沢 | act032, act057 |
| E2Eテストのflaky削減（70%減） | e020 篠宮 | act026, act082 |
| 脆弱性の自動トリアージ（月400件→50件） | e024 織部 | act037, act100 |
| アクセシビリティ改善 | e017 柚木 | act027 |
| プロンプトのバージョン管理 | e014 東雲 | act043 |
| 手書きOCRの精度改善（78%→93%） | e018 久我 | act064 |
| dbtへのデータ基盤移行 | e022 皆川 | act069 |
| 改ざん検知可能な監査ログ | e023 氷室 | act085 |
| フロントエンドの表示速度改善（LCP 1.8秒短縮） | e012 百瀬 | act088 |
| オンコール負荷の削減（夜間呼び出し 月14回→5回） | e016 鳴海 | act102 |
| オンボーディングへのAIエージェント導入 | e026 鷹野 | act110 |

### 発信済み（6件）

act017, act036, act038, act059, act097, act111

### 依頼ごとの想定候補

| 依頼 | 想定する提案 |
| --- | --- |
| req001（枠だけ） | 未発信ネタを持っていて、忙しさが低め〜中くらいの人。例：e012 百瀬（表示速度改善、忙しさ2）、e018 久我（OCR、忙しさ3） |
| req002（AIエージェントの品質評価） | e013 早乙女（評価基盤）。補助で e014 東雲（プロンプトのバージョン管理）。いつもの e003 久住だけに偏らないか |
| req003（障害の振り返り） | e015 芹沢（ポストモーテム）。ただし忙しさ5なので負荷への配慮が要る。代案に e016 鳴海（オンコール改善） |
| req004（e002を指名） | 指名された e002 は忙しさ5でテーマとの一致も弱い。実際にやった e012 百瀬を代案か共同登壇で出せるか |
| req005（e007を指名） | 自動トリアージを作ったのは e024 織部。e007 梶との共同登壇などを提案できるか |

e001 青柳の週報（act111）に「登壇依頼を受けきれないので他の人に回したい」とあり、偏りの課題を裏づけるデータになっています。
