# techevent-agent

## 概要

LayerX 自律型 AI Agent ハッカソン 2026/11 テーマ3「Techイベントを一気通貫で支援せよ」の成果物。

## 想定ユーザー

技術広報。社外向けtechイベント（勉強会・LT会・共催イベント・登壇）の企画・運営と、社内の技術発信の推進を担う。

## 課題

- 上流：社内の「これやりました」が発信されずに埋もれている。発信する人としない人の差が広がっている。未発信のネタは誰にも見えない
- 運営：会場・設備の手配、各種申請、飲食の発注、集客、当日運営、事後処理がほぼ手作業
- 申請は会場や曜日で条件が変わり（例：金曜開催はゴミ回収の申請が必要）、漏れのチェックがギリギリになりがち
- 飲食の発注数を経験と勘で決めている
- 核心：定型作業の自動化ならツールでもできる。「なぜAgentなのか」に答えること

## Must

1. 未発信の取り組みの発見から発信まで一気通貫で支援する（発信の形・質まで担保する）
2. 申請・手配・発注などの定型作業は、人間が最終確認・承認するだけで済む形にする

## Want

- 発信する人としない人の差を埋める
- Agent前提でイベントと発信のやり方自体を考え直す
- 使うほど賢くなる（来場データで発注精度が上がる、フィードバックでネタ提案が個人に合っていく）

## 評価基準

1. 顧客の本当の課題を特定できているか
2. ツールやチャットボットではなくAI Agentである理由があるか
3. 使い込むことで成長する要素があるか
4. 動くものを作り切り、体験にこだわれたか

## 最終発表

スライド2枚＋デモ、5分以内

## ディレクトリ構成・技術スタック

MVPの仕様は [docs/spec.md](docs/spec.md)（v0.4：ネタ帳Agent）。保存の入口の一覧は [docs/storage.md](docs/storage.md)、発表のあとと将来の作業は [docs/roadmap.md](docs/roadmap.md)。発表と質問の答えに使う数字（評価・テスト・費用・安全。出どころと日時つき）は [docs/numbers.md](docs/numbers.md)。

中心は「Agentが育て続けるネタ帳（カード）」で、動きは3つだけ：カードを作る（ネタ帳を更新）／カードから選ぶ（依頼への提案・ブログのネタ）／カードに書き戻す（承認・承諾・辞退・公開）。

- Next.js（App Router）＋TypeScript、Claude API の tool use（`@anthropic-ai/sdk`）
- Agentのループは `AGENT_MODEL`（既定 claude-opus-5-5）、声かけ文や代わりの人を推す理由づけは `HEAVY_MODEL`（既定 claude-fable-5-2、失敗したら Opus で作り直す）
- 累計の使用額が `USAGE_SWITCH_USD`（既定 $150）を超えると、ループを Sonnet 5.5、重い仕事を Opus 5.5 に自動で切り替える

```
app/            画面（左：ネタ帳／右：依頼パネル）とAPI（agent・notebook はNDJSONで作業ログを流す）
lib/cards.ts    ネタ帳（data/cards.json）。保存前に根拠idを検証、確認済みカードは人の修正を上書きしない
lib/notebook.ts ネタ帳の更新（社員ごとに1回呼び出し、upsert_card でカードを作る）
lib/agent.ts    依頼への提案のループ（ネタ帳を先に検索、上限15ステップ、合う人がいるだけ5人まで、人数はそろえない）
lib/blog.ts     ブログのネタ（未発信のカードから3枚）
lib/tools.ts    ツール（search_cards / get_card / upsert_card ほか、data/*.json を読む）
lib/prompt.ts   指示文と社員一覧（プロンプトキャッシュの対象）
lib/heavy.ts    声かけ文・LT構成案、代わりの人を推す理由
lib/pricing.ts  料金表（ここだけ直せばよい）
lib/usage.ts    使用量の記録（data/usage.json）とモデルの自動切り替え
data/           ダミーデータ（説明は data/README.md）
scripts/        データ生成・検証、評価スクリプト
```

### 起動

`.env` に `ANTHROPIC_API_KEY`・`AGENT_MODEL`・`HEAVY_MODEL`・`USAGE_SWITCH_USD` を書いてから：

```bash
npm install
npm run dev
```

http://localhost:3000 を開く。APIキーはサーバー側だけで使い、ブラウザには出しません。サーバーは既定で `127.0.0.1` だけで待ち受け、すべての画面と `/api` で Host と Origin が localhost／127.0.0.1 かを確かめます（`proxy.ts`・`lib/share.ts`。同じ端末からだけ使える）。`npm run dev`・`npm start` は `scripts/serve.mjs` を通り、待ち受け先は `.env` の `BIND_HOST` で決まります。

- 画面の一番上は受信箱です。Slack（`POST /api/inbox`、形は [docs/inbox-api.md](docs/inbox-api.md)）や「会話を貼って追加」で届いた依頼に、Agentが候補を準備しておきます
- APIを使わずに画面を見るときは http://localhost:3000/?mock（保存済みの結果で受信箱に「準備済み」の依頼が並びます）
- 受信箱のテスト（APIなし）：`npm run test:inbox`

### 本番用のビルドで見せる（メンターに触ってもらうとき）

開発サーバー（`npm run dev`）の代わりに、本番用にビルドしたものを 3000 番で動かします。画面の左下に開発用の印（N の丸）が出ず、表示も速くなります。待ち受けは開発サーバーと同じく `127.0.0.1` だけです（受信箱の窓口を localhost に限るため。Slack ボットの窓口 `http://127.0.0.1:3000` もそのまま使えます）。

1. 開発サーバーを止める（動かしているターミナルで Ctrl+C）。動いたままビルドすると `.next` がぶつかるので、先に止める
2. ビルドする（API は使わない。数十秒）：

   ```bash
   npm run build
   ```

3. 起動する（`scripts/serve.mjs` を通して `next start`。待ち受けは `.env` の `BIND_HOST`、既定 127.0.0.1）：

   ```bash
   npm run start
   ```

4. http://127.0.0.1:3000 を開く（API を使わずに見せるときは http://127.0.0.1:3000/?mock）

- `.env` は起動のときに読みます。`.env` を書き換えたら、Ctrl+C で止めて `npm run start` し直す
- コード（画面・lib/）を変えたら、`npm run build` からやり直す（本番用のビルドは自動では作り直されない）
- 開発サーバーに戻すときは、Ctrl+C で止めて `npm run dev`
- カード詳細の「出し先を探す」で、そのネタを出せそうな社外イベント（data/external_events.json、2026-11-21時点）とブログ案を探します。テスト（APIなし）：`npm run test:venues`

#### 会場の参加者に触ってもらう（発表用と見せる用を分けて立てる）

**合言葉は会場の全員に公開する前提**です。合言葉は「同じネットワークの外から入られない」ためのもので、知っている人は全員使えます。そのため、見せる用は発表用とは別のサーバー・別のデータの置き場で立て、API 代の上限を必ず付けます。

| | 発表用 | 見せる用 |
| --- | --- | --- |
| 起動 | `npm start` | `npm run start:share` |
| 待ち受け | 127.0.0.1:3000（この端末だけ） | 0.0.0.0:3100（同じネットワークの全員） |
| データの置き場 | 今までどおり（data/runtime/・data/inbox.json など） | data/runtime-share/（受信箱・下書き・分析・金額の記録もすべてここ） |
| 合言葉・上限 | なし | `ACCESS_CODE`（12文字以上）・`SHARE_BUDGET_USD` が必須（足りなければ起動しない）。合言葉は送り元ごとに5分で5回、全体で5分に30回を超えて間違えると、しばらく受け付けない |
| Slack ボット | つなぐ（`INBOX_BASE_URL` は既定の http://127.0.0.1:3000） | つながない（ボットは発表用以外には起動を拒む） |
| ?debug（API 代の表示） | 出せる | 出さない（外した URL に移す） |
| 「ネタ帳を更新」 | 使える | 止める（理由を画面に出す） |
| API を使う操作 | 同時に2件まで（超えたら最大60秒待ち、空かなければ 429 で断って理由を出す） | 同時に2件まで（同じく最大60秒待ってから断る） |

1. 設定：`.env` に `ACCESS_CODE=（その日だけの合言葉、12文字以上。例：netacho-1122-hanami）` と `SHARE_BUDGET_USD=5` を書く。`SHARE_MODE` は書かない（書いても発表用は使わない）
2. ビルド：`npm run build`（両方のサーバーが同じビルドを使う。開発サーバーでは見せる用を立てない）
3. 発表用：`npm start` → 最初の行が `発表用：http://127.0.0.1:3000 で待ち受けます（この端末からだけ）`
4. 見せる用：別のターミナルで `npm run start:share` → 最初の行が `見せる用（SHARE_MODE=lan）：http://192.168.x.x:3100 …API 代の上限 $5。データは data/runtime-share`
5. 合言葉の伝え方：スライドや会場のチャンネルに、見せる用の URL と合言葉を出してよい（全員に公開する前提）。そのぶん、上限・見せる用のデータの分離・ネタ帳の更新の停止で守っている
6. 見せる用を初期状態に戻す：`npm run reset:share`（見せる用の置き場だけ。発表用のデータには触らない）。見せる用の金額：`npm run usage -- --share`
7. 終わったら：見せる用を Ctrl+C で止める → `.env` の `ACCESS_CODE` を消す（**合言葉は捨てる**。次は新しく決める）→ `npm run usage -- --share` で金額を確かめる → `npm run reset:share`

#### Slackから依頼を受け付ける（練習用ワークスペース専用）

依頼チャンネルへの新しい投稿を受信箱に入れるボットです。Socket Mode なので外部公開URLはいりません。

- 依頼スレッドには「受け付けました。技術広報から連絡します」とだけ返します
- 準備ができたら、技術広報だけが入る非公開チャンネル（`SLACK_NOTIFY_CHANNEL`）に「新しい依頼の候補が準備できました」と画面へのリンクだけを送ります
- 候補の名前・理由・件数・見つからない理由は、Slack のどこにも書きません（依頼チャンネルは社内の人が見るため。人選は技術広報が画面で見ます）

1. 練習用ワークスペースに Slack アプリを作る
   - Socket Mode をオンにし、App-Level Token（`connections:write`）を作る → `SLACK_APP_TOKEN`（xapp-）
   - Bot Token Scopes：`channels:history`・`chat:write`（非公開チャンネルなら `groups:history` も）
   - Event Subscriptions の bot events：`message.channels`（非公開チャンネルなら `message.groups`）
   - ワークスペースにインストールし、Bot User OAuth Token → `SLACK_BOT_TOKEN`（xoxb-）
   - 依頼チャンネルにボットを招待し、チャンネルid（C…）→ `SLACK_REQUEST_CHANNEL`
   - 通知用の非公開チャンネルを作る（技術広報だけを入れる）。チャンネル名の横の「︙」→「チャンネル設定」で非公開にし、`/invite @ボット名` でボットを招待する（非公開チャンネルはボットを招待しないと送れません）。チャンネル詳細の一番下にある id（C… または G…）→ `SLACK_NOTIFY_CHANNEL`。書かなければ通知しません
2. `.env` に上の4つを書く（名前は `.env.example`）。トークンの値は表示・コミットしない。ボットが呼ぶ窓口は既定で `http://127.0.0.1:3000`（dev サーバーは 127.0.0.1 だけで待ち受けるため。Windows では `localhost` が ::1 に向くことがあるので、`INBOX_BASE_URL` を変えるときも 127.0.0.1 で書く）
3. ターミナルを2つ開いて、それぞれで起動する

```bash
npm run dev
```

```bash
npm run slack
```

起動すると、接続先のワークスペース名を表示します。練習用であることを確かめてください。本番では `SLACK_ALLOWED_TEAM_ID`（練習用ワークスペースの team id）を必ず設定してください。ほかのワークスペースでは起動しなくなり、起動したあとも投稿ごとにワークスペースを見て、違う投稿には何も返しません。

受け取りの決まり（`scripts/slack/core.ts` の `makeMessageHandler`）：

- 画像・ファイルつきの投稿は、本文があれば本文だけを依頼として受け付けます（ファイルは読みません）。本文がなければ受け付けません
- URL だけ・スタンプだけなど依頼の文がない投稿は、受信箱に入れずに「依頼の文が見つかりませんでした」と返します
- 同じ人から同じ文が10分以内に来たら、受信箱に足さずに「同じ依頼を受け付けています」と返します（記録はボットのメモリの中だけ。受信箱に入れられなかった依頼の投稿し直しは数えません）
- スレッドに返すのは決まった文だけです（候補の名前や依頼の中身は書きません）

Slack なしで確かめるとき（トークン不要。仮の受信箱サーバーで、拾う・無視する投稿と、Slack に出す文に候補の情報が入らないことを確かめる）：

```bash
npm run slack:dry-run
```

ネタ帳（data/cards.json）はコミット済みなので、すぐに使えます。新しい活動を読ませるときは画面の「ネタ帳を更新」を押すか、コマンドで：

```bash
npm run notebook -- pending
```

（新しい活動がある社員だけを読みます。全30人分を作り直すと約$0.45）

#### イベント後のアンケート（v0.4）

画面上部の「イベント」で過去イベントを開き、Googleフォームの回答をスプレッドシートから書き出した CSV を取り込みます（架空データは `data/surveys/{event_id}.csv`）。メール・名前の列は取り込み時に捨てます。「アンケートを分析する」を押すと、件数・平均はコードで数え、Agentが感想を文ごとに良い点と不満に分けて、ネガティブ（運営／内容・原文のまま全部）とポジティブ（テーマごと）にまとめ、登壇者のカードに書き戻します（運営への不満と原文・攻撃の言葉はカードに入れない）。書き戻した提案（確認済みカードの反応・需要あり・テーマ案）はカード詳細で採用／見送りします。1イベント約$0.05〜0.1。

```bash
npm run test:surveys
```

（APIなしのテスト）

```bash
npx tsx scripts/analyze_surveys.ts all
```

（本番で分析して `docs/survey_latest.json` に残す。`data/cards.json` は元に戻す。続けて `npx tsx scripts/update_postevent_mock.ts` で `?mock` の再生データを作る）

#### 本物のデータ（GitHub）から作る

架空データの代わりに、開発者本人の公開リポジトリ（fork・アーカイブを除く）の説明・README・PR・コミット・Issue からネタ帳を作れます。メールアドレス・非公開リポジトリ・ほかの人のコメントは取り込みません。

1. 取り込み（APIクレジットは使いません。GitHub のトークンも不要）：

   ```bash
   npm run import:github -- --user eggplant-umrk
   ```

   `data/sources/github/` に `activities.json` と本人1人分の `employees.json` ができます（取り込み済みのものをコミットしてあります）。GitHub のレート制限にかかったときだけ、`.env` の `GITHUB_TOKEN`（読み取り専用、任意）を使います。

2. 切り替え：`.env` に `DATA_SOURCE=github` を書いて `npm run dev`（コマンドなら `DATA_SOURCE=github npm run notebook -- pending`）。カードは `data/sources/github/cards.json` に保存され、架空データのネタ帳は変わりません。1人分の更新で約$0.3。

`DATA_SOURCE` を消すと架空データに戻ります。評価（`npm run eval`）は常に架空データで動きます。

#### ブログと Slack の一部

人を選ぶ材料に、社内技術ブログ（架空、`data/sources/blog_posts.json`）と Slack の一部を足しています。どちらもネタ帳の更新（`npm run notebook -- pending`）でそのまま読みます。

Slack から読むとき（練習用ワークスペースだけ）：

1. 読みたいチャンネル（`#share` など）にボットを招待する（チャンネルで `/invite @ボット名`）。公開チャンネルだけ読みます。ボットに `channels:history` と `channels:read` の権限が要ります
2. チャンネルの id（C で始まる。チャンネル名を右クリック →「リンクをコピー」の末尾）を `.env` の `SLACK_SOURCE_CHANNELS` に書く（複数ならカンマ区切り）
3. `data/sources/slack_users.json` に「Slack のユーザー id → 社員 id」を書く（例：`{ "U0123ABC": "e012" }`）。対応がない人の投稿は読みません。読んだときに、対応表にいない人の id と件数を出します
4. 読む：`npm run slack:sources`（前回以降の投稿だけ。ボット・通知・30字未満は落とし、本文の先頭400字・リンク・日時だけを保存）。そのあと `npm run notebook -- pending`

Slack に接続せずに確かめる：`npm run slack:sources:dry-run`。テスト（APIなし）：`npm run test:sources`

#### リリースノート（チームのネタ）

バクラクの公開リリース10件（`data/sources/release_notes.json`、要約は自分の言葉、担当の割り当ては架空）を材料に足しています。ネタ帳の更新とは別に、次でカードにします（カードになっていないものだけ）：

```bash
npm run release:cards -- --dry-run
npm run release:cards
```

- 1つ目は API を使わず、読むリリースノートと担当者・候補だけを出します。2つ目は API を使います（10件で約$0.1）
- 担当者が分かるものはその人のカードに、分からないものは推測で付けずに「担当者未定のネタ」（`data/unassigned_cards.json`）になります。一覧は `GET /api/unassigned-cards`、割り当ては `POST /api/unassigned-cards/assign`（`{ "card_id": "card-team-01", "employee_id": "e011" }`）。割り当てたカードは確認済みになります
- テスト（APIなし）：`npm run test:release`

#### デモ用：本人を31人目として入れる

デモで開発者本人を架空の会社の一員として候補に出すときは、`.env` に `DEMO_PERSON=on` を書いて `npm run dev` します。

- 本人のプロフィールと活動は `data/sources/github/`（上の取り込み）の本物をそのまま使い、id だけ `e031`・`act201〜` に振り直します。登壇0回なので「初登壇」の印が付きます
- 本人の予定は `.env` の `CALENDAR_ICS_URL`（テスト用 Google アカウントのカレンダーの iCal URL。秘密）から読みます。なければ「予定は不明」です
- 本人のカードは `data/sources/demo-person/` に保存され、架空の30人のネタ帳は変わりません（取り込み済みの8枚をコミットしてあります）。本人のネタ帳を作り直すときは `DEMO_PERSON=on npm run notebook -- e031`（約$0.3）
- 評価（`npm run eval`）は `DEMO_PERSON` があっても30人で動きます。`DATA_SOURCE=github` とは同時に使えません
- テスト（APIなし）：`npm run test:demo`

#### 忙しさ（予定から計算）

社員の忙しさは、決め打ちの数字ではなく予定から計算します（`lib/busyness.ts`、AIは使いません）。「今後2週間の平日・勤務時間（10〜19時）のうち、予定で埋まっている割合」を出し、画面では「今後2週間は勤務時間の7割が予定で埋まっている」のように言葉で出します。予定がない人は「予定は不明」です。

- 架空の社員：`data/calendar.json`（時間単位の予定）と `data/schedules.json`（出張・休暇）から計算します
- **本番はカレンダーの iCal URL を設定します**：`.env` に `CALENDAR_ICS_URL=`（Google カレンダーなら「iCal 形式の非公開 URL」）を書きます。**この URL は秘密です**（知っている人は誰でも予定を読めます）。表示・ログ・コミット・チャットへの貼り付けをしないでください。読むのは開始・終了・終日かどうかだけで、予定のタイトル・場所・参加者は読みません。今は本人（`DATA_SOURCE=github` または `DEMO_PERSON=on` の31人目）にだけ使います
- テスト（APIなし）：`npm run test:busyness`

#### デモの前に初期状態に戻す

画面で打診を記録したり、カードを直したり、ネタ帳を更新したりした結果は `data/runtime/`（git の対象外）に入り、元のデータ（git に入っている `data/` のファイル）は変わりません。デモの前に次で初期状態に戻せます（片付けたものは `data/runtime-backup/` に移ります）：

```bash
npm run reset:demo
```

本物の Slack から読んだ投稿（`data/sources/slack_posts.json`）はコミットしません。

### テスト（API なし・4つの層）

```bash
npm test
```

テストは4つの層に分けてあります（役割・速さ・流し方は [docs/testing.md](docs/testing.md)）。`npm test` は 1. ユニット（`npm run test:unit`）→ 2. API（`npm run test:api`、本物のサーバーを3201・3202番で立て、偽の Anthropic につないで窓口に要求を投げる）→ 4. 評価（`npm run test:eval`、保存済みの結果の判定）を順に流します。3. E2E（`npm run test:e2e`、Playwright で画面のデモの流れを通す）は時間がかかるので `npm run test:all` にだけ入れています（初めてのときは `npx playwright install chromium`）。

どの層も本物の API・Slack は使わず、`.env` も要りません。1つの層が失敗しても残りを流し、最後に層ごとの結果を出します。一部だけ流すときは `npm test -- inbox stage` のように名前の一部を書きます（ユニットだけ）。API・E2E は本番用のビルドを使うので、**本番用のサーバー（`npm start`・`npm run start:share`）が動いている間はビルドしません**。push のたびに GitHub Actions（`.github/workflows/ci.yml`）で、型チェックとあわせて全部の層が流れます。

### 評価

2段で評価します（APIクレジットを使います。全件で約$0.75）。

1. 結合テスト（コードで判定、90%未満で失敗）：根拠idの実在・送信は依頼スレッドへの受付の返信と非公開チャンネルへの通知の2か所だけ（文は決まった文）・想定候補が候補（5人まで）に入るか・候補は5人までで自信のある候補が先・登壇経験の印・代わりの提案・ネタ帳のカード化（未発信20件中15件以上）・書き戻し後に提案が変わるか
2. テーマ案の質：LLMで採点し、v0.1（before）との差を記録

想定候補は `data/README.md` から評価スクリプトだけが読みます。

```bash
npm run eval -- req004
npm run eval -- all --report docs/eval_after.md
npx tsx scripts/eval_report.ts
```

結果：[docs/eval_before.md](docs/eval_before.md)（v0.1）／[docs/eval_after.md](docs/eval_after.md)（v0.2 と比較）

## ライセンス

[MIT](LICENSE)
