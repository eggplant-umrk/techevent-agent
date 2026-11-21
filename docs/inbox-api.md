# 受信箱の窓口（inbox API）

Slackボット（セッション②）が使う窓口です。**この形は変えません。** 変えるときはこの文書を先に直して、両方のセッションで合わせます。

- 受け付けるのは同じマシン（localhost）からのリクエストだけです。ほかのホスト名や、転送元（`X-Forwarded-For`）が外のアドレスのリクエストは `403` を返します
- 開発サーバーは `npm run dev` で `127.0.0.1:3000` だけで待ち受けます
- 依頼を受け取ると、Agentが裏で候補づくりを始めます（APIクレジットを使います。1件 $0.1〜0.2 程度）
- 送信の機能はありません。候補と声かけ文の下書きは、画面で人が確認して送ります

## POST /api/inbox

依頼を受信箱に入れて、候補づくりを始めます。すぐに返ります（候補づくりは裏で続きます）。

受け取る（JSON）：

```json
{
  "text": "依頼の本文（1〜4000文字）",
  "source": "slack",
  "meta": { "channel": "C0123", "ts": "1763700000.000100", "user": "U0123", "permalink": "https://….slack.com/archives/C0123/p1763700000000100" }
}
```

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| `text` | ○ | 依頼の本文。前後の空白は落とします |
| `source` | ○ | `"slack"` か `"manual"`（画面の「手で追加」） |
| `meta` | | Slackの情報。`channel`・`ts`・`user`・`permalink`（どれも文字列、省略可）。`permalink` は画面に「Slackで開く」として出します |

返す：`200`

```json
{ "id": "inb-mhx2k9p0-3fa21c" }
```

エラー：`400 { "error": "text が空です" }`（入力の誤り）、`403`（localhost 以外）

## GET /api/inbox/{id}

依頼の状態と、準備できた候補の要約を返します。Slackで「準備済み」を知らせるときに使ってください（数秒おきに確かめる想定）。

返す：`200`

```json
{
  "id": "inb-mhx2k9p0-3fa21c",
  "status": "ready",
  "summary": {
    "candidates": [
      { "name": "百瀬 結衣", "confidence": "strong", "reason_short": "依存の整理とコード分割で、LCPを中央値で1.8秒縮めました。" },
      { "name": "笹倉 由紀", "confidence": "conditional", "reason_short": "指名された本人です。" }
    ],
    "no_fit": { "reasons": ["初期表示の改善を実際にやった記録は百瀬さんのPRだけでした"] }
  },
  "url": "http://localhost:3000/?inbox=inb-mhx2k9p0-3fa21c"
}
```

| 項目 | 説明 |
| --- | --- |
| `status` | `"processing"`（準備中）／`"ready"`（準備済み）／`"error"`（エラー） |
| `summary` | `ready` のときだけ入ります |
| `summary.candidates` | 候補（最大3人、おすすめ順）。`confidence` は `"strong"`（自信のある候補）か `"conditional"`（条件付きの候補）。`reason_short` は理由の先頭1文（60字まで） |
| `summary.no_fit` | 候補が3人に満たないときだけ入ります。`reasons` は見つからない理由 |
| `url` | 画面でこの依頼を開くURL。開くと、準備済みの候補画面がすぐ出ます（もう一度は実行しません） |

- `summary` の文には、内部の項目名・値・id（`reviewed=false`、`act088` など）が入らないように判定しています（`lib/plainText.ts`）。入っていた文は、テーマ案に置き換えるか落とします
- `processing` のまま15分を過ぎたもの（サーバーの再起動などで止まったもの）は `error` として返します

エラー：`404`（その id がない）、`403`（localhost 以外）

## 画面用（窓口ではありません）

画面が使う補助のルートです。Slackボットからは使わないでください。

- `GET /api/inbox`：一覧（新しい順）
- `GET /api/inbox/{id}/detail`：1件の全体（保存した候補と作業ログ）
- `POST /api/inbox/{id}/open`：開いた印を付ける（「新しい依頼」の印が外れる）

## 試し方（APIクレジットを使わない）

- 画面：`http://localhost:3000/?mock` を開くと、保存済みの結果を使った「準備済み」の依頼が受信箱に並びます
- テスト：`npm run test:inbox`（本物のAgentの代わりに保存済みの結果を使って、受け取り→準備済み、返す形、内部の言葉、localhost の判定を確かめます）
