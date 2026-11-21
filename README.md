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

MVPの仕様は [docs/spec.md](docs/spec.md)（v0.2：ネタ帳Agent）。

中心は「Agentが育て続けるネタ帳（カード）」で、動きは3つだけ：カードを作る（ネタ帳を更新）／カードから選ぶ（依頼への提案・ブログのネタ）／カードに書き戻す（承認・承諾・辞退・公開）。

- Next.js（App Router）＋TypeScript、Claude API の tool use（`@anthropic-ai/sdk`）
- Agentのループは `AGENT_MODEL`（既定 claude-opus-5-5）、声かけ文や代わりの人を推す理由づけは `HEAVY_MODEL`（既定 claude-fable-5-2、失敗したら Opus で作り直す）
- 累計の使用額が `USAGE_SWITCH_USD`（既定 $150）を超えると、ループを Sonnet 5.5、重い仕事を Opus 5.5 に自動で切り替える

```
app/            画面（左：ネタ帳／右：依頼パネル）とAPI（agent・notebook はNDJSONで作業ログを流す）
lib/cards.ts    ネタ帳（data/cards.json）。保存前に根拠idを検証、確認済みカードは人の修正を上書きしない
lib/notebook.ts ネタ帳の更新（社員ごとに1回呼び出し、upsert_card でカードを作る）
lib/agent.ts    依頼への提案のループ（ネタ帳を先に検索、上限15ステップ、合う人がいなければ3人そろえない）
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

http://localhost:3000 を開く。APIキーはサーバー側だけで使い、ブラウザには出しません。開発サーバーは `127.0.0.1` だけで待ち受けます（受信箱の窓口を localhost に限るため）。

- 画面の一番上は受信箱です。Slack（`POST /api/inbox`、形は [docs/inbox-api.md](docs/inbox-api.md)）や「手で追加」で届いた依頼に、Agentが候補を準備しておきます
- APIを使わずに画面を見るときは http://localhost:3000/?mock（保存済みの結果で受信箱に「準備済み」の依頼が並びます）
- 受信箱のテスト（APIなし）：`npm run test:inbox`
- カード詳細の「出し先を探す」で、そのネタを出せそうな社外イベント（data/external_events.json、2026-11-21時点）とブログ案を探します。テスト（APIなし）：`npm run test:venues`

#### Slackから依頼を受け付ける（練習用ワークスペース専用）

依頼チャンネルへの新しい投稿を受信箱に入れ、準備ができたら同じスレッドに候補を返すボットです。Socket Mode なので外部公開URLはいりません。投稿するのは、依頼が来たチャンネルのスレッドへの返信だけです。

1. 練習用ワークスペースに Slack アプリを作る
   - Socket Mode をオンにし、App-Level Token（`connections:write`）を作る → `SLACK_APP_TOKEN`（xapp-）
   - Bot Token Scopes：`channels:history`・`chat:write`（非公開チャンネルなら `groups:history` も）
   - Event Subscriptions の bot events：`message.channels`（非公開チャンネルなら `message.groups`）
   - ワークスペースにインストールし、Bot User OAuth Token → `SLACK_BOT_TOKEN`（xoxb-）
   - 依頼チャンネルにボットを招待し、チャンネルid（C…）→ `SLACK_REQUEST_CHANNEL`
2. `.env` に上の3つを書く（名前は `.env.example`）。トークンの値は表示・コミットしない。ボットが呼ぶ窓口は既定で `http://127.0.0.1:3000`（dev サーバーは 127.0.0.1 だけで待ち受けるため。Windows では `localhost` が ::1 に向くことがあるので、`INBOX_BASE_URL` を変えるときも 127.0.0.1 で書く）
3. ターミナルを2つ開いて、それぞれで起動する

```bash
npm run dev
```

```bash
npm run slack
```

起動すると、接続先のワークスペース名を表示します。練習用であることを確かめてください。本番では `SLACK_ALLOWED_TEAM_ID`（練習用ワークスペースの team id）を必ず設定してください。ほかのワークスペースでは起動しなくなります。

Slack なしで確かめるとき（トークン不要。仮の受信箱サーバーで、拾う・無視する投稿と返信の内容を確かめる）：

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

### 評価

2段で評価します（APIクレジットを使います。全件で約$0.75）。

1. 結合テスト（コードで判定、90%未満で失敗）：根拠idの実在・送信は依頼が来たSlackスレッドへの返信1か所だけ・想定候補が上位3人に入るか・代わりの提案・ネタ帳のカード化（未発信20件中15件以上）・書き戻し後に提案が変わるか
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
