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

MVPの仕様は [docs/spec.md](docs/spec.md)。

- Next.js（App Router）＋TypeScript、Claude API の tool use（`@anthropic-ai/sdk`）
- Agentのループは `AGENT_MODEL`（既定 claude-opus-5-5）、声かけ文や代わりの人を推す理由づけは `HEAVY_MODEL`（既定 claude-fable-5-2、失敗したら Opus で作り直す）
- 累計の使用額が `USAGE_SWITCH_USD`（既定 $150）を超えると、ループを Sonnet 5.5、重い仕事を Opus 5.5 に自動で切り替える

```
app/            画面（page.tsx）とAPI（api/agent はNDJSONで作業ログを流す）
lib/agent.ts    Agentのループ（上限15ステップ）
lib/tools.ts    ツール（data/*.json を読む）
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

http://localhost:3000 を開く。APIキーはサーバー側だけで使い、ブラウザには出しません。

### 評価

`data/README.md` の想定候補と、Agentの上位3人を照らし合わせます（APIクレジットを使います。1件 $0.1〜0.2 程度）。

```bash
npm run eval -- req004
npm run eval -- all
```

## ライセンス

[MIT](LICENSE)
