"""Generate fictional demo data for techevent-agent (data/*.json).

All people, posts, companies and events are fictional.
Deterministic: fixed random seed.
"""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(20261121)

WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"]

# ---------------------------------------------------------------------------
# employees (30) — top 5 hold most of the talks
# ---------------------------------------------------------------------------
# (id, name, unit, role, tags, talk_count, busyness)
EMP = [
    ("e001", "青柳 恭平", "CTO室", "CTO室 エンジニア", ["アーキテクチャ", "技術戦略", "LLM", "組織づくり"], 18, 4),
    ("e002", "笹倉 由紀", "バクラク", "エンジニアリングマネージャー", ["チームビルディング", "TypeScript", "プロダクト開発プロセス"], 12, 5),
    ("e003", "久住 拓真", "Ai Workforce", "MLエンジニア", ["LLM", "RAG", "AIエージェント", "Python"], 10, 4),
    ("e004", "相良 美帆", "Fintech", "バックエンドエンジニア", ["Go", "金融システム", "分散トランザクション"], 8, 3),
    ("e005", "千早 航", "バクラク", "QAエンジニア", ["テスト自動化", "品質保証", "E2Eテスト"], 7, 3),
    ("e006", "宇佐美 環", "Ai Workforce", "プロダクトマネージャー", ["プロダクトマネジメント", "AIエージェント", "ユーザーリサーチ"], 2, 4),
    ("e007", "梶 真之介", "セキュリティ", "セキュリティエンジニア", ["クラウドセキュリティ", "脆弱性管理", "AWS"], 1, 3),
    ("e008", "日向 さくら", "バクラク", "デザイナー", ["UIデザイン", "デザインシステム", "Figma"], 1, 2),
    ("e009", "真壁 透", "Fintech", "SRE", ["SRE", "Kubernetes", "可観測性"], 1, 4),
    ("e010", "猪瀬 りん", "バクラク", "フロントエンドエンジニア", ["React", "TypeScript", "状態管理"], 0, 3),
    ("e011", "葛西 陽向", "バクラク", "バックエンドエンジニア", ["検索", "Elasticsearch", "Go", "ベクトル検索"], 0, 3),
    ("e012", "百瀬 結衣", "バクラク", "フロントエンドエンジニア", ["Webパフォーマンス", "React", "ビルドツール"], 0, 2),
    ("e013", "早乙女 蓮", "Ai Workforce", "MLエンジニア", ["LLM評価", "AIエージェント", "MLOps", "Python"], 0, 4),
    ("e014", "東雲 健吾", "Ai Workforce", "バックエンドエンジニア", ["LLM", "プロンプトエンジニアリング", "TypeScript"], 0, 3),
    ("e015", "芹沢 葵", "Fintech", "バックエンドエンジニア", ["障害対応", "バッチ処理", "Go", "PostgreSQL"], 0, 5),
    ("e016", "鳴海 慎", "バクラク", "SRE", ["SRE", "オンコール", "Terraform", "可観測性"], 0, 4),
    ("e017", "柚木 ほのか", "バクラク", "デザイナー", ["アクセシビリティ", "UIデザイン", "UXリサーチ"], 0, 2),
    ("e018", "久我 大地", "バクラク", "MLエンジニア", ["OCR", "画像認識", "PyTorch"], 0, 3),
    ("e019", "朝比奈 光", "Ai Workforce", "フロントエンドエンジニア", ["React", "チャットUI", "ストリーミング"], 0, 2),
    ("e020", "篠宮 悠", "バクラク", "QAエンジニア", ["E2Eテスト", "Playwright", "CI"], 0, 3),
    ("e021", "仁科 涼介", "Fintech", "プロダクトマネージャー", ["金融規制", "プロダクトマネジメント"], 0, 5),
    ("e022", "皆川 七海", "CTO室", "データエンジニア", ["データ基盤", "dbt", "BigQuery"], 0, 3),
    ("e023", "氷室 圭", "Fintech", "バックエンドエンジニア", ["監査ログ", "金融規制", "Go", "設計"], 0, 4),
    ("e024", "織部 隼人", "セキュリティ", "セキュリティエンジニア", ["サプライチェーンセキュリティ", "SBOM", "自動化"], 0, 3),
    ("e025", "白洲 楓", "セキュリティ", "セキュリティエンジニア", ["ID管理", "ゼロトラスト"], 0, 2),
    ("e026", "鷹野 未来", "CTO室", "エンジニアリングマネージャー", ["オンボーディング", "AIエージェント", "組織づくり"], 0, 4),
    ("e027", "東條 怜", "Ai Workforce", "バックエンドエンジニア", ["Python", "ワークフローエンジン", "非同期処理"], 0, 3),
    ("e028", "小野寺 舞", "バクラク", "プロダクトマネージャー", ["プロダクトマネジメント", "SaaS", "ユーザーリサーチ"], 0, 4),
    ("e029", "蔵本 湊", "Fintech", "SRE", ["AWS", "コスト最適化", "Terraform"], 0, 2),
    ("e030", "雨宮 紬", "CTO室", "テクニカルライター", ["技術ドキュメント", "Docs as Code"], 0, 2),
]
TOP5 = ["e001", "e002", "e003", "e004", "e005"]
MINOR = ["e006", "e007", "e008", "e009"]

# ---------------------------------------------------------------------------
# events (20 past events). speakers chosen to match the skew.
# ---------------------------------------------------------------------------
EVENTS_SPEC = [
    # (date, title, series, venue, venue_type, capacity, speakers)
    ("2025-01-24", "layerx.go #12 SaaSのマルチテナント設計", "layerx.go", "自社イベントスペース", "internal", 60, ["e001", "e002"]),
    ("2025-02-19", "QA Night #5 E2Eテストを育てる", "QA Night", "自社イベントスペース", "internal", 40, ["e005"]),
    ("2025-03-13", "AIエージェント設計勉強会 #1", "AIエージェント設計勉強会", "自社イベントスペース", "internal", 80, ["e003", "e001"]),
    ("2025-04-18", "Fintech Engineering Meetup #3", "Fintech Engineering Meetup", "外部：渋谷ハーバーホール", "external", 120, ["e004"]),
    ("2025-05-22", "layerx.go #13 Goで書くバッチ処理", "layerx.go", "自社イベントスペース", "internal", 60, ["e004", "e009"]),
    ("2025-06-11", "AIエージェント設計勉強会 #2 RAGの現場", "AIエージェント設計勉強会", "自社イベントスペース", "internal", 80, ["e003"]),
    ("2025-07-04", "共催 SaaS開発組織LT会（with 架空テック株式会社）", "共催LT会", "外部：五反田テックラウンジ", "external", 100, ["e002", "e008"]),
    ("2025-07-30", "QA Night #6 テスト自動化の投資対効果", "QA Night", "自社イベントスペース", "internal", 40, ["e005"]),
    ("2025-08-28", "layerx.go #14 夏のアーキテクチャ祭り", "layerx.go", "自社イベントスペース", "internal", 60, ["e001", "e002"]),
    ("2025-09-19", "AIエージェント設計勉強会 #3 評価をどうするか", "AIエージェント設計勉強会", "外部：品川カンファレンスルームA", "external", 150, ["e003", "e006"]),
    ("2025-10-16", "バクラク Tech Talk #4 プロダクト開発の速さ", "バクラク Tech Talk", "自社イベントスペース", "internal", 50, ["e002"]),
    ("2025-11-28", "Fintech Engineering Meetup #4 金融×クラウド", "Fintech Engineering Meetup", "外部：渋谷ハーバーホール", "external", 120, ["e004", "e007"]),
    ("2026-01-23", "layerx.go #15 LLMをプロダクトに入れる", "layerx.go", "自社イベントスペース", "internal", 60, ["e001", "e003"]),
    ("2026-02-25", "QA Night #7 AI時代のQA", "QA Night", "自社イベントスペース", "internal", 40, ["e005", "e002"]),
    ("2026-03-19", "AIエージェント設計勉強会 #4 マルチエージェント", "AIエージェント設計勉強会", "自社イベントスペース", "internal", 80, ["e003", "e001"]),
    ("2026-05-15", "共催 生成AIプロダクト開発LT（with 架空AIラボ株式会社）", "共催LT会", "外部：五反田テックラウンジ", "external", 100, ["e001"]),
    ("2026-06-24", "layerx.go #16 型とテストの話", "layerx.go", "自社イベントスペース", "internal", 60, ["e002", "e005"]),
    ("2026-07-17", "バクラク Tech Talk #5 夏の開発組織", "バクラク Tech Talk", "自社イベントスペース", "internal", 50, ["e002", "e001"]),
    ("2026-09-11", "AIエージェント設計勉強会 #5 本番運用", "AIエージェント設計勉強会", "外部：品川カンファレンスルームA", "external", 150, ["e003", "e001"]),
    ("2026-10-30", "layerx.go #17 金融とSaaSのあいだ", "layerx.go", "自社イベントスペース", "internal", 60, ["e004", "e001"]),
]

events = []
speaker_dates: dict[str, list[str]] = {}
for i, (d, title, series, venue, vtype, cap, speakers) in enumerate(EVENTS_SPEC, 1):
    dt = date.fromisoformat(d)
    applications = int(cap * rng.uniform(0.75, 1.0))
    rate = rng.uniform(0.6, 0.9)
    attendees = round(applications * rate)
    # catering: ordered by gut feeling ~ 80-95% of applications
    ordered_food = int(applications * rng.uniform(0.8, 0.95))
    events.append({
        "id": f"ev{i:03d}",
        "title": title,
        "series": series,
        "date": d,
        "weekday": WEEKDAYS_JA[dt.weekday()],
        "start_time": "19:00",
        "venue": venue,
        "venue_type": vtype,
        "capacity": cap,
        "applications": applications,
        "attendees": attendees,
        "attendance_rate": round(attendees / applications, 2),
        "speaker_ids": speakers,
        "catering": {
            "food_servings_ordered": ordered_food,
            "food_servings_left": max(0, ordered_food - attendees - rng.randint(-3, 3)),
            "drinks_ordered": int(ordered_food * 1.5),
        },
    })
    for s in speakers:
        speaker_dates.setdefault(s, []).append(d)

# talks outside our own events (external conferences etc.) for last_talk_date fallback
EXTERNAL_LAST = {"e004": "2026-08-07", "e005": "2026-09-26", "e002": "2026-10-09"}

employees = []
for eid, name, unit, role, tags, count, busy in EMP:
    dates = list(speaker_dates.get(eid, []))
    if eid in EXTERNAL_LAST:
        dates.append(EXTERNAL_LAST[eid])
    assert len(speaker_dates.get(eid, [])) <= count, eid
    employees.append({
        "id": eid,
        "name": name,
        "business_unit": unit,
        "role": role,
        "expertise_tags": tags,
        "past_talk_count": count,
        "last_talk_date": max(dates) if dates else None,
        "workload": busy,
    })

# ---------------------------------------------------------------------------
# activities (120)
# ---------------------------------------------------------------------------
# Hidden gems: talk-worthy but never shared outside. (type, author, date, title, body, channel, repo, theme)
GEMS = [
    # G1 search quality
    ("slack_post", "e011", "2026-09-08", "取引先検索、ハイブリッド検索に切り替えた結果",
     "請求書の取引先検索をキーワード検索とベクトル検索のハイブリッドに切り替えました。表記ゆれ（株式会社の位置、全角半角）での取りこぼしが大きく減り、オフライン評価でnDCG@10が0.62から0.81になりました。リランキングの重みはまだ手で調整しています。",
     "#bakuraku-search", None),
    ("github_pr", "e011", "2026-09-17", "取引先検索: RRFでキーワード検索とベクトル検索の結果を統合",
     "Reciprocal Rank Fusionで2つの検索結果を統合します。評価用のクエリセット300件とスクリプトも同梱しました。p95レイテンシは+18msで許容範囲です。",
     None, "bakuraku/search-service"),
    ("design_doc", "e011", "2026-10-02", "検索品質の継続評価の仕組み",
     "検索改善を感覚ではなく数字で回すため、評価クエリセットの作り方と更新ルールをまとめました。ユーザーのクリックログから正解ラベルを半自動で作る方法を採用しています。他プロダクトの検索にも転用できる構成です。",
     None, "cto-office/design-docs"),
    # G2 incident retrospective
    ("design_doc", "e015", "2026-09-25", "ポストモーテム: 月末決済バッチの4時間遅延",
     "9月末の決済バッチが4時間遅延した件の振り返りです。原因はロック競合で、リトライが雪だるま式に増えていました。検知から復旧までのタイムラインと、再発防止としてバッチの分割と冪等化を行った経緯を記録しています。",
     None, "fintech/postmortems"),
    ("weekly_report", "e015", "2026-10-09", "週報 10/5-10/9 芹沢",
     "決済バッチの冪等化が本番に入りました。分割後は月末の処理時間が平均で40%短くなっています。ポストモーテムの内容は他チームからも参考にしたいと声がありました。",
     "#weekly-fintech", None),
    # G3 agent evaluation platform
    ("github_pr", "e013", "2026-09-14", "エージェント評価: LLM-as-a-judgeによる回帰テストをCIに追加",
     "プロンプトやツール定義を変えたときに、過去の正解ケース200件でエージェントの挙動を自動評価します。判定用LLMのブレを抑えるため、3回判定の多数決にしました。",
     None, "ai-workforce/agent-eval"),
    ("slack_post", "e013", "2026-10-06", "評価基盤のおかげでモデル切り替えが1日で終わった",
     "新しいモデルへの切り替え、以前は手動確認で1週間かかっていたのが評価基盤のおかげで1日で判断できました。ツール呼び出しの誤りが増えるケースも事前に見つかっています。判定のブレをどう扱うかはまだ試行錯誤中です。",
     "#ai-workforce-dev", None),
    ("design_doc", "e013", "2026-10-20", "AIエージェント評価基盤 設計ドキュメント v2",
     "評価ケースの管理、判定LLMの選定、人手評価との一致率の測り方をまとめました。人手評価との一致率は現在87%です。評価コストを月額で見積もる方法も載せています。",
     None, "ai-workforce/design-docs"),
    # G4 OCR handwriting
    ("slack_post", "e018", "2026-10-14", "手書き領収書のOCR精度が上がりました",
     "手書き領収書の金額読み取り精度が78%から93%になりました。合成データで手書き数字を増やしたのが一番効いています。失敗パターンの分類も一通り終わりました。",
     "#bakuraku-ml", None),
    # G5 flaky tests
    ("weekly_report", "e020", "2026-09-18", "週報 9/14-9/18 篠宮",
     "E2Eテストのflaky率を週次で集計する仕組みを作りました。原因の6割が待ち合わせ処理の不備で、残りはテストデータの共有によるものでした。来週から順に潰していきます。",
     "#weekly-bakuraku-qa", None),
    ("github_pr", "e020", "2026-10-23", "E2E: テストごとにテナントを分離してflakyを解消",
     "テストデータの共有が原因のflakyをなくすため、テストごとに使い捨てテナントを作るようにしました。これでflaky率は月初比で70%減りました。CI時間は+2分です。",
     None, "bakuraku/e2e-tests"),
    # G6 SBOM triage
    ("design_doc", "e024", "2026-09-29", "依存ライブラリ脆弱性の自動トリアージ",
     "SBOMを全リポジトリで生成し、脆弱性アラートを実際に到達可能なコードかどうかで自動で振り分けます。対応が必要なアラートは全体の12%に絞り込めました。誤判定の扱いを今後詰めます。",
     None, "security/design-docs"),
    ("slack_post", "e024", "2026-11-04", "脆弱性アラート、月400件→対応要50件に",
     "自動トリアージを全社展開しました。開発チームに届くアラートが月400件から50件程度になっています。判定ロジックはOSSとして切り出せそうです。",
     "#security", None),
    # G7 bundle size
    ("github_pr", "e012", "2026-10-28", "バンドル分割と依存整理で初期表示を1.8秒短縮",
     "使っていない日付ライブラリと重複していたアイコンセットを削除し、ルート単位でコード分割しました。初期JSは2.1MBから900KBに、LCPは中央値で1.8秒短くなりました。",
     None, "bakuraku/web-frontend"),
    # G8 prompt versioning
    ("slack_post", "e014", "2026-10-01", "プロンプトをコードと同じようにレビューする運用を始めた",
     "プロンプトをリポジトリで管理し、変更はPRでレビューして評価結果を添える運用にしました。本番でのA/B比較もフラグで切り替えられます。「なんとなく変えて壊れる」がなくなりました。",
     "#ai-workforce-dev", None),
    # G9 dbt
    ("weekly_report", "e022", "2026-10-16", "週報 10/12-10/16 皆川",
     "データ基盤のSQLをdbtに移行し終えました。テストとリネージが見えるようになり、指標の定義違いによる問い合わせが減っています。移行手順はドキュメント化済みです。",
     "#weekly-cto-office", None),
    # G10 accessibility
    ("slack_post", "e017", "2026-09-22", "スクリーンリーダーで経費申請を最後まで通せるようにしました",
     "スクリーンリーダー利用者の方へのインタビューをもとに、経費申請フローのフォーカス順とラベルを直しました。キーボードだけで申請が完了できるようになっています。チェックリストはデザインシステムに入れる予定です。",
     "#bakuraku-design", None),
    # G11 on-call
    ("design_doc", "e016", "2026-11-06", "オンコール負荷の可視化と削減",
     "アラートを発報元と対応内容で分類し、対応不要なアラートを半分に減らしました。夜間呼び出しは月14回から5回になっています。ダッシュボードの作り方も記載しました。",
     None, "bakuraku/sre-docs"),
    # G12 onboarding agent
    ("slack_post", "e026", "2026-11-11", "新入社員オンボーディングにAIエージェントを試験導入",
     "社内ドキュメントを参照して質問に答え、初週のタスクを進めてくれるエージェントを試しています。10月入社の5名で、立ち上がりまでの期間が体感で半分になったという声がありました。",
     "#cto-office", None),
    # G13 audit log
    ("design_doc", "e023", "2026-10-27", "改ざん検知可能な監査ログ基盤の設計",
     "金融規制の要件を満たすため、ハッシュチェーンで改ざんを検知できる監査ログを設計しました。書き込み性能を落とさないための非同期化の工夫と、監査対応時の検索方法をまとめています。",
     None, "fintech/design-docs"),
]
GEM_THEMES = {
    0: "検索精度の改善", 1: "検索精度の改善", 2: "検索精度の改善",
    3: "障害対応の振り返り", 4: "障害対応の振り返り",
    5: "AIエージェントの評価基盤", 6: "AIエージェントの評価基盤", 7: "AIエージェントの評価基盤",
    8: "手書きOCRの精度改善", 9: "E2Eテストのflaky削減", 10: "E2Eテストのflaky削減",
    11: "脆弱性の自動トリアージ", 12: "脆弱性の自動トリアージ",
    13: "フロントエンドの表示速度改善", 14: "プロンプトのバージョン管理",
    15: "dbtへのデータ基盤移行", 16: "アクセシビリティ改善", 17: "オンコール負荷の削減",
    18: "オンボーディングへのAIエージェント導入", 19: "改ざん検知可能な監査ログ",
}

# Already shared outside (talks / blog posts) — mostly by the frequent speakers.
SHARED = [
    ("slack_post", "e003", "2026-09-12", "AIエージェント設計勉強会#5の資料を公開しました",
     "昨日の登壇資料をSpeaker Deckに公開しました。本番運用でのガードレール設計の話です。質問が多かったところは追ってブログにします。", "#tech-pr", None),
    ("slack_post", "e001", "2026-09-30", "テックブログ公開: LLMプロダクトのアーキテクチャ選定",
     "テックブログを公開しました。社内で議論した選定基準をまとめています。シェアお願いします。", "#tech-pr", None),
    ("slack_post", "e004", "2026-10-31", "layerx.go #17 登壇しました",
     "金融とSaaSのデータ整合性の話をしました。アーカイブは来週公開予定です。", "#tech-pr", None),
    ("slack_post", "e005", "2026-09-27", "外部カンファレンスでQAの話をしてきました",
     "テスト自動化の投資対効果について話しました。懇親会で他社のQAの方と情報交換できたのが収穫でした。", "#tech-pr", None),
    ("slack_post", "e002", "2026-10-10", "テックブログ公開: 開発プロセスを週次で見直す",
     "チームの振り返りの仕組みを記事にしました。採用広報にも使ってもらえると嬉しいです。", "#tech-pr", None),
    ("weekly_report", "e001", "2026-11-13", "週報 11/9-11/13 青柳",
     "社外登壇の依頼が3件来ています。全部は受けきれないので、他の人に回せないか技術広報と相談中です。", "#weekly-cto-office", None),
]

# Routine noise
NOISE_SLACK = [
    ("ステージング環境が重いです", "ステージングのレスポンスが遅いです。誰か心当たりありますか。ログを見た感じDBの接続数が上限に近いです。", ["#dev-help"]),
    ("明日のリリース内容の確認", "明日のリリース対象を確認しました。差分は3件で、マイグレーションはありません。リリース後の確認担当は私がやります。", ["#release"]),
    ("ライブラリのメジャーバージョンアップ", "UIライブラリのメジャーアップデートが出ています。破壊的変更が多いので来月まとめて対応します。影響範囲を調べた人がいたら教えてください。", ["#frontend"]),
    ("勉強会のお知らせ", "来週の社内勉強会は型システムの入門です。初心者歓迎です。資料は後で共有します。", ["#engineering"]),
    ("CIが落ちています", "mainのCIが落ちています。原因は外部APIのモックの期限切れでした。修正PRを出しました。", ["#dev-help"]),
    ("問い合わせ対応の共有", "お客様から帳票の出力が遅いと問い合わせがありました。特定の条件で全件取得になっていたので修正します。", ["#cs-eng"]),
    ("新メンバーの紹介", "今週から新しいメンバーがチームに加わりました。前職ではモバイル開発をしていたそうです。よろしくお願いします。", ["#general"]),
    ("ランチ会の案内", "金曜にチーム横断のランチ会をやります。参加希望の方はスタンプを押してください。", ["#random"]),
    ("権限申請のやり方", "本番DBの読み取り権限の申請方法がわからないという質問が多いので、手順書のリンクを貼っておきます。", ["#dev-help"]),
    ("監視アラートの閾値変更", "CPUアラートの閾値を80%から85%に変更しました。通知が多すぎたためです。様子を見て戻すかもしれません。", ["#sre"]),
    ("デザインレビュー依頼", "新しい一覧画面のデザインをレビューしてほしいです。フィルタの位置で迷っています。今週中にコメントもらえると助かります。", ["#design"]),
    ("仕様の確認", "請求書の承認フローで差し戻し時の通知先について確認させてください。現状は申請者のみですが、承認者にも送るべきでしょうか。", ["#product"]),
    ("AWSのコスト", "先月のAWSコストが少し増えていました。開発環境のインスタンスの止め忘れが原因でした。自動停止を設定済みです。", ["#infra"]),
    ("Slackの通知整理", "アラート用チャンネルが増えすぎたので整理しました。統合先の一覧はチャンネルの説明欄にあります。", ["#engineering"]),
    ("採用面接の調整", "来週のカジュアル面談の担当を探しています。バックエンドの経験がある方だと助かります。", ["#recruiting"]),
    ("リリースしました", "一覧画面の並び替え機能をリリースしました。不具合を見つけたら教えてください。", ["#release"]),
]
NOISE_PR = [
    ("依存ライブラリの定期アップデート", "マイナーバージョンのアップデートのみです。CIが通ることを確認しました。"),
    ("typo修正", "エラーメッセージの誤字を修正しました。"),
    ("一覧APIにページネーションを追加", "件数が多いテナントでタイムアウトしていたためページネーションを追加しました。既存のクライアントは影響を受けません。"),
    ("ログ出力の整理", "デバッグ用のログが本番で出ていたので削除しました。構造化ログの項目も揃えています。"),
    ("テストの追加", "金額計算の境界値テストを追加しました。カバレッジは2ポイント上がります。"),
    ("リファクタリング: 共通処理の切り出し", "3か所に重複していた日付変換を共通関数にまとめました。挙動は変わりません。"),
    ("環境変数の追加", "新しい外部連携のためのAPIキー用の環境変数を追加しました。値はシークレット管理に登録済みです。"),
    ("不要なフィーチャーフラグの削除", "全テナントで有効化済みのフラグを削除しました。"),
    ("エラーハンドリングの改善", "外部APIのタイムアウト時に500ではなくリトライ可能なエラーを返すようにしました。"),
    ("Terraform: ステージングのインスタンスサイズ変更", "負荷試験のため一時的にサイズを上げます。試験後に戻します。"),
    ("文言の変更", "ビジネス側からの依頼で、確認ダイアログの文言を変更しました。"),
    ("マイグレーション: インデックス追加", "検索が遅いクエリのためにインデックスを追加しました。ロックは発生しない方法で作成します。"),
]
REPOS = {
    "バクラク": ["bakuraku/web-frontend", "bakuraku/api", "bakuraku/search-service", "bakuraku/e2e-tests", "bakuraku/infra"],
    "Ai Workforce": ["ai-workforce/agent-runtime", "ai-workforce/web", "ai-workforce/agent-eval"],
    "Fintech": ["fintech/core-banking", "fintech/batch", "fintech/infra"],
    "セキュリティ": ["security/scanners", "security/iam-policies"],
    "CTO室": ["cto-office/data-platform", "cto-office/internal-tools"],
}
NOISE_DOC = [
    ("通知機能のリニューアル方針", "通知の種類ごとに配信チャネルを選べるようにする方針をまとめました。既存の設定は移行します。レビューをお願いします。"),
    ("APIのバージョニング方針", "外部公開APIのバージョニングをURLで行うかヘッダで行うかの比較です。結論はURL方式です。"),
    ("権限モデルの整理", "ロールが増えすぎたので整理案を作りました。既存テナントへの影響は移行スクリプトで吸収します。"),
    ("ログ保持期間の見直し", "コストと監査要件のバランスから、ログの保持期間を種類ごとに見直しました。"),
    ("CSVインポートの仕様", "CSVインポートのバリデーションとエラー表示の仕様です。文字コードの自動判定を含みます。"),
    ("四半期の技術的負債リスト", "今四半期に返済する技術的負債の候補を優先度順に並べました。"),
]
DOC_REPO = {
    "バクラク": "bakuraku/design-docs", "Ai Workforce": "ai-workforce/design-docs",
    "Fintech": "fintech/design-docs", "セキュリティ": "security/design-docs", "CTO室": "cto-office/design-docs",
}
NOISE_WEEKLY = [
    "今週は問い合わせ対応が中心でした。来週から新機能の実装に入ります。",
    "スプリントの目標は8割達成でした。残りは来週に持ち越します。レビュー待ちが溜まっているので解消したいです。",
    "採用面接が4件ありました。開発は小さな改修のみです。",
    "障害対応はありませんでした。リファクタリングを進めています。",
    "仕様調整のミーティングが多く、実装はあまり進みませんでした。来週は集中時間を確保します。",
    "リリースを1件出しました。大きな問題はありません。来週はテストの拡充をします。",
    "オンボーディング資料の更新をしました。新メンバーのフォローも継続中です。",
]
WEEKLY_CH = {
    "バクラク": "#weekly-bakuraku", "Ai Workforce": "#weekly-ai-workforce",
    "Fintech": "#weekly-fintech", "セキュリティ": "#weekly-security", "CTO室": "#weekly-cto-office",
}

emp_by_id = {e["id"]: e for e in employees}
start, end = date(2026, 9, 1), date(2026, 11, 20)


def rand_weekday() -> date:
    while True:
        d = start + timedelta(days=rng.randint(0, (end - start).days))
        if d.weekday() < 5:
            return d


def friday_on_or_before(d: date) -> date:
    return d - timedelta(days=(d.weekday() - 4) % 7)


raw = []
for t, a, d, ti, b, ch, rp in GEMS + SHARED:
    raw.append({"type": t, "author_id": a, "date": d, "title": ti, "body": b, "channel": ch, "repo": rp})

n_noise = 120 - len(raw)
noise_types = (["slack_post"] * 40 + ["github_pr"] * 28 + ["weekly_report"] * 18 + ["design_doc"] * 8)
assert len(noise_types) == n_noise, (len(noise_types), n_noise)
rng.shuffle(noise_types)
seen = {(r["author_id"], r["title"]) for r in raw}


def make_noise(t):
    emp = rng.choice(employees)
    unit = emp["business_unit"]
    d = rand_weekday()
    if t == "slack_post":
        ti, b, chs = rng.choice(NOISE_SLACK)
        return {"type": t, "author_id": emp["id"], "date": d.isoformat(), "title": ti, "body": b, "channel": rng.choice(chs), "repo": None}
    if t == "github_pr":
        ti, b = rng.choice(NOISE_PR)
        return {"type": t, "author_id": emp["id"], "date": d.isoformat(), "title": ti, "body": b, "channel": None, "repo": rng.choice(REPOS[unit])}
    if t == "design_doc":
        ti, b = rng.choice(NOISE_DOC)
        return {"type": t, "author_id": emp["id"], "date": d.isoformat(), "title": ti, "body": b, "channel": None, "repo": DOC_REPO[unit]}
    fri = friday_on_or_before(d)
    if fri < start:
        fri += timedelta(days=7)
    mon = fri - timedelta(days=4)
    ti = f"週報 {mon.month}/{mon.day}-{fri.month}/{fri.day} {emp['name'].split()[0]}"
    return {"type": t, "author_id": emp["id"], "date": fri.isoformat(), "title": ti, "body": rng.choice(NOISE_WEEKLY), "channel": WEEKLY_CH[unit], "repo": None}


for t in noise_types:
    while True:
        item = make_noise(t)
        if (item["author_id"], item["title"]) not in seen:
            break
    seen.add((item["author_id"], item["title"]))
    raw.append(item)

raw.sort(key=lambda x: (x["date"], x["author_id"], x["title"]))
activities = []
gem_ids, shared_ids = [], []
gem_keys = {(g[1], g[3]): GEM_THEMES[i] for i, g in enumerate(GEMS)}
shared_keys = {(s[1], s[3]) for s in SHARED}
gem_answer = []
for i, r in enumerate(raw, 1):
    aid = f"act{i:03d}"
    activities.append({"id": aid, **r})
    k = (r["author_id"], r["title"])
    if k in gem_keys:
        gem_answer.append((aid, r["author_id"], gem_keys[k]))
    if k in shared_keys:
        shared_ids.append(aid)

# ---------------------------------------------------------------------------
# requests (5)
# ---------------------------------------------------------------------------
requests = [
    {
        "id": "req001",
        "pattern": "open_slot",
        "received_at": "2026-11-16",
        "requester": {"organization": "架空クラウド株式会社", "contact_name": "（架空）採用広報担当", "channel": "email"},
        "event": {"title": "SaaSエンジニア合同LTナイト Vol.8", "date": "2026-12-17", "format": "LT", "duration_min": 10, "audience": "SaaS企業のエンジニア 約80名", "venue": "外部：新宿スカイホール", "online": False},
        "theme": None,
        "nominated_employee_id": None,
        "reference": None,
        "reply_deadline": "2026-11-27",
        "message": "来月の合同LTナイトでLayerXさんの枠を1つ用意しています。テーマはお任せしますので、どなたかご登壇いただけないでしょうか。",
    },
    {
        "id": "req002",
        "pattern": "theme_specified",
        "received_at": "2026-11-18",
        "requester": {"organization": "AIエージェント実践コミュニティ（架空）", "contact_name": "（架空）運営スタッフ", "channel": "connpass_message"},
        "event": {"title": "AIエージェント実践Meetup #9", "date": "2027-01-21", "format": "セッション", "duration_min": 25, "audience": "LLMアプリ開発者 約150名", "venue": "オンライン", "online": True},
        "theme": "AIエージェントの品質をどう評価・担保しているか",
        "nominated_employee_id": None,
        "reference": None,
        "reply_deadline": "2026-12-04",
        "message": "AIエージェントを本番で運用している企業として、評価や品質担保の取り組みについてお話しいただけないでしょうか。具体的な数値や失敗談があると参加者に喜ばれます。",
    },
    {
        "id": "req003",
        "pattern": "theme_specified",
        "received_at": "2026-11-19",
        "requester": {"organization": "架空ペイメンツ株式会社", "contact_name": "（架空）VPoE", "channel": "email"},
        "event": {"title": "金融システム障害から学ぶ会（共催打診）", "date": "2027-02-10", "format": "パネル＋セッション", "duration_min": 20, "audience": "金融系エンジニア 約60名", "venue": "自社イベントスペース（LayerX開催を希望）", "online": False},
        "theme": "障害対応と振り返りの文化",
        "nominated_employee_id": None,
        "reference": None,
        "reply_deadline": "2026-12-10",
        "message": "障害の振り返りをテーマにした共催イベントを検討しています。LayerXさんの会場をお借りできれば嬉しいです。登壇者もお一人出していただけないでしょうか。",
    },
    {
        "id": "req004",
        "pattern": "named_speaker",
        "received_at": "2026-11-20",
        "requester": {"organization": "フロントエンド性能研究会（架空）", "contact_name": "（架空）主催者", "channel": "x_dm"},
        "event": {"title": "Web Performance Night 2027 Winter", "date": "2027-01-28", "format": "セッション", "duration_min": 20, "audience": "フロントエンドエンジニア 約100名", "venue": "外部：渋谷ハーバーホール", "online": False},
        "theme": "大規模SaaSの初期表示改善",
        "nominated_employee_id": "e002",
        "reference": {"kind": "event_archive", "title": "layerx.go #16 型とテストの話（アーカイブ動画）", "url": "https://example.com/archive/layerx-go-16"},
        "reply_deadline": "2026-12-05",
        "message": "layerx.goのアーカイブで笹倉さんのお話を拝見しました。フロントエンドの性能改善についてぜひ笹倉さんにご登壇いただきたいです。",
        "note_for_demo": "指名先はよく登壇するEMだが、テーマに直接合うのは未発信の e012（バンドル削減でLCP 1.8秒短縮）。本人の確認を取りつつ代案を出せるかを見るケース。",
    },
    {
        "id": "req005",
        "pattern": "named_speaker",
        "received_at": "2026-11-20",
        "requester": {"organization": "クラウドセキュリティ勉強会（架空）", "contact_name": "（架空）運営", "channel": "email"},
        "event": {"title": "サプライチェーンセキュリティ Day", "date": "2027-02-18", "format": "セッション", "duration_min": 30, "audience": "セキュリティ/SRE 約120名", "venue": "オンライン", "online": True},
        "theme": "脆弱性管理の自動化",
        "nominated_employee_id": "e007",
        "reference": {"kind": "slide", "title": "Fintech Engineering Meetup #4 登壇資料", "url": "https://example.com/slides/fintech-meetup-4"},
        "reply_deadline": "2026-12-12",
        "message": "以前のMeetupでの梶さんの資料を拝見しました。脆弱性管理の自動化について30分お話しいただけないでしょうか。",
        "note_for_demo": "指名先 e007 は同じセキュリティ事業部。実際に自動トリアージを作ったのは未発信の e024 なので、共同登壇の提案などができるかを見るケース。",
    },
]

# ---------------------------------------------------------------------------
# application rules
# ---------------------------------------------------------------------------
rules = [
    {"id": "rule001", "name": "ゴミ回収申請", "applies_when": {"venue_type": ["internal"], "weekdays": ["金"]},
     "reason": "ビル管理の定期回収が金曜夜はないため、イベントのゴミは別途回収を依頼する必要がある",
     "submit_to": "ビル管理会社", "deadline_days_before": 5, "approver": "総務"},
    {"id": "rule002", "name": "空調延長申請", "applies_when": {"venue_type": ["internal"], "months": [6, 7, 8, 9]},
     "reason": "夏季は19時以降の空調が自動停止するため延長が必要",
     "submit_to": "ビル管理会社", "deadline_days_before": 3, "approver": "総務"},
    {"id": "rule003", "name": "暖房延長申請", "applies_when": {"venue_type": ["internal"], "months": [12, 1, 2]},
     "reason": "冬季は19時以降の暖房が自動停止するため延長が必要",
     "submit_to": "ビル管理会社", "deadline_days_before": 3, "approver": "総務"},
    {"id": "rule004", "name": "警備会社への連絡", "applies_when": {"min_expected_attendees": 51},
     "reason": "50人を超える集まりは警備会社に事前連絡し、入館動線の確認を受ける",
     "submit_to": "警備会社", "deadline_days_before": 7, "approver": "総務"},
    {"id": "rule005", "name": "社外者入館申請", "applies_when": {"venue_type": ["internal"]},
     "reason": "社外の参加者を入館させるには、氏名リストの事前登録が必要",
     "submit_to": "ビル受付", "deadline_days_before": 2, "approver": "総務"},
    {"id": "rule006", "name": "時間外利用申請", "applies_when": {"venue_type": ["internal"], "end_after": "21:00"},
     "reason": "21時以降のフロア利用は時間外利用として申請が必要",
     "submit_to": "ビル管理会社", "deadline_days_before": 5, "approver": "総務"},
    {"id": "rule007", "name": "土日祝の休日入館申請", "applies_when": {"venue_type": ["internal"], "weekdays": ["土", "日"]},
     "reason": "休日はビルが閉館しているため休日入館の申請が必要",
     "submit_to": "ビル管理会社", "deadline_days_before": 10, "approver": "総務"},
    {"id": "rule008", "name": "飲酒を伴うイベントの届出", "applies_when": {"alcohol": True},
     "reason": "社内規程により、アルコールを提供するイベントは事前に届け出る",
     "submit_to": "総務", "deadline_days_before": 7, "approver": "総務部長"},
    {"id": "rule009", "name": "外部会場の飲食持込申請", "applies_when": {"venue_type": ["external"], "catering": True},
     "reason": "外部会場は会場ごとに飲食の持込可否と申請様式が異なる",
     "submit_to": "会場運営者", "deadline_days_before": 14, "approver": "技術広報"},
    {"id": "rule010", "name": "外部会場の利用契約稟議", "applies_when": {"venue_type": ["external"]},
     "reason": "外部会場の利用料は稟議が必要",
     "submit_to": "経理（稟議システム）", "deadline_days_before": 21, "approver": "部門長"},
    {"id": "rule011", "name": "配信機材の貸出申請", "applies_when": {"online": True, "venue_type": ["internal"]},
     "reason": "ハイブリッド配信を行う場合は情報システム部の配信機材を予約する",
     "submit_to": "情報システム部", "deadline_days_before": 7, "approver": "情報システム部"},
    {"id": "rule012", "name": "年末年始の閉館期間", "applies_when": {"date_range": {"from": "12-28", "to": "01-04"}},
     "reason": "年末年始はビルが閉館しており、イベント開催不可",
     "submit_to": None, "deadline_days_before": None, "approver": None, "blocking": True},
    {"id": "rule013", "name": "100人超の消防署への届出", "applies_when": {"venue_type": ["internal"], "min_expected_attendees": 101},
     "reason": "自社スペースで100人を超える場合は催物開催届が必要（収容上限の確認を含む）",
     "submit_to": "所轄消防署（ビル管理会社経由）", "deadline_days_before": 14, "approver": "総務"},
]
rules_doc = {
    "description": "イベント開催時に必要な申請のルール。applies_when の条件をすべて満たすときに申請が必要。",
    "condition_keys": {
        "venue_type": "internal（自社イベントスペース）/ external（外部会場）のいずれかに一致",
        "weekdays": "開催曜日（月〜日）のいずれかに一致",
        "months": "開催月のいずれかに一致",
        "date_range": "MM-DD形式の期間（年をまたぐ）に開催日が含まれる",
        "min_expected_attendees": "想定参加者数がこの値以上",
        "end_after": "終了時刻がこの時刻より後",
        "alcohol": "アルコール提供の有無",
        "catering": "飲食提供の有無",
        "online": "オンライン配信の有無",
    },
    "internal_venue": {"name": "自社イベントスペース", "capacity": 120},
    "rules": rules,
}


def dump(name, obj):
    # newline="\n": keep LF on Windows so regenerating does not rewrite every file.
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


dump("employees.json", employees)
dump("activities.json", activities)
dump("events.json", events)
dump("requests.json", requests)
dump("application_rules.json", rules_doc)

# ---------------------------------------------------------------------------
# published (40) — "直近の発信" DB. Skewed to the frequent speakers.
# Generated after everything else so earlier files stay byte-identical.
# ---------------------------------------------------------------------------
TEAM = {
    "e001": "CTO室", "e002": "バクラク 請求書チーム", "e003": "Ai Workforce エージェント基盤チーム",
    "e004": "Fintech 勘定系チーム", "e005": "バクラク QAチーム", "e006": "Ai Workforce プロダクトチーム",
    "e007": "セキュリティ プラットフォームチーム", "e008": "バクラク デザインチーム", "e009": "Fintech SREチーム",
    "e025": "セキュリティ IDチーム", "e028": "バクラク 経費精算チーム", "e030": "CTO室",
}
# (author, published_at, genre, title, tags, target_reader)
PUB = [
    ("e001", "2025-02-03", "登壇資料", "SaaSのマルチテナント設計 ─ layerx.go #12", ["アーキテクチャ", "SaaS"], "マルチテナントSaaSを設計するエンジニア"),
    ("e001", "2025-04-21", "メンバーのブログ", "技術選定の判断記録を残す文化", ["技術戦略", "組織づくり"], "技術選定に関わるリードエンジニア"),
    ("e001", "2025-06-30", "インタビュー記事", "CTO室が考える、これからのLayerXの技術", ["技術戦略"], "LayerXに興味がある候補者"),
    ("e001", "2025-09-01", "登壇資料", "夏のアーキテクチャ祭り 基調講演", ["アーキテクチャ"], "アーキテクチャに関心のあるエンジニア"),
    ("e001", "2026-01-26", "登壇資料", "LLMをプロダクトに入れるときの設計判断", ["LLM", "アーキテクチャ"], "LLM機能を作るエンジニア"),
    ("e001", "2026-03-23", "登壇資料", "マルチエージェント設計の勘所", ["AIエージェント", "LLM"], "AIエージェントを作るエンジニア"),
    ("e001", "2026-05-18", "登壇資料", "生成AIプロダクト開発の現実", ["LLM"], "生成AIプロダクトの開発者"),
    ("e001", "2026-09-30", "メンバーのブログ", "LLMプロダクトのアーキテクチャ選定", ["LLM", "アーキテクチャ"], "LLMプロダクトの技術選定をする人"),
    ("e004", "2026-11-02", "登壇資料", "金融とSaaSのあいだ ─ layerx.go #17", ["アーキテクチャ", "金融システム"], "SaaSと金融の両方に関心のあるエンジニア"),
    ("e002", "2025-02-10", "メンバーのブログ", "EMになって1年で変えたこと", ["チームビルディング"], "新任のEM"),
    ("e002", "2025-07-07", "登壇資料", "SaaS開発組織のスピードを保つ仕組み", ["プロダクト開発プロセス"], "開発組織のリーダー"),
    ("e002", "2025-10-20", "登壇資料", "プロダクト開発の速さを支える型", ["TypeScript", "プロダクト開発プロセス"], "TypeScriptで開発するチーム"),
    ("e002", "2026-02-27", "イベントレポート", "QA Night #7 開催レポート", ["品質保証"], "QAとの協業に関心のある開発者"),
    ("e002", "2026-06-26", "登壇資料", "型とテストで守る請求書ドメイン", ["TypeScript", "テスト自動化"], "業務SaaSの開発者"),
    ("e002", "2026-07-20", "インタビュー記事", "バクラクの開発組織が大事にしていること", ["チームビルディング"], "LayerXに興味がある候補者"),
    ("e002", "2026-10-10", "メンバーのブログ", "開発プロセスを週次で見直す", ["プロダクト開発プロセス"], "チームの改善を回したい人"),
    ("e003", "2025-03-17", "登壇資料", "AIエージェント設計入門", ["AIエージェント", "LLM"], "AIエージェントを作り始めた人"),
    ("e003", "2025-06-13", "登壇資料", "RAGの現場でハマったこと", ["RAG", "LLM"], "RAGを本番に入れたい人"),
    ("e003", "2025-09-22", "登壇資料", "AIエージェントの評価をどうするか（入門編）", ["AIエージェント", "LLM評価"], "LLMアプリの品質に悩む人"),
    ("e003", "2026-01-27", "メンバーのブログ", "社内のLLM基盤を1年運用して", ["LLM", "Python"], "LLM基盤の運用者"),
    ("e003", "2026-03-20", "登壇資料", "マルチエージェントの協調パターン", ["AIエージェント"], "AIエージェントを作るエンジニア"),
    ("e003", "2026-09-12", "登壇資料", "AIエージェントの本番運用とガードレール", ["AIエージェント", "LLM"], "AIエージェントを本番で動かす人"),
    ("e003", "2026-10-05", "Podcast", "AIエージェントの今を語る", ["AIエージェント"], "AIエージェントの動向を追う人"),
    ("e004", "2025-04-22", "登壇資料", "金融システムをGoで書く", ["Go", "金融システム"], "金融系のバックエンドエンジニア"),
    ("e004", "2025-05-26", "登壇資料", "Goで書くバッチ処理の設計", ["Go"], "バッチ処理を設計する人"),
    ("e004", "2025-12-01", "登壇資料", "金融×クラウドの分散トランザクション", ["分散トランザクション", "金融システム"], "金融×クラウドのエンジニア"),
    ("e004", "2026-08-10", "メンバーのブログ", "残高計算の整合性をどう守るか", ["金融システム", "Go"], "金融系のバックエンドエンジニア"),
    ("e004", "2026-11-04", "イベントレポート", "layerx.go #17 アーカイブ公開", ["金融システム"], "イベントに参加できなかった人"),
    ("e005", "2025-02-21", "登壇資料", "E2Eテストを育てる", ["E2Eテスト", "テスト自動化"], "E2Eテストを始めたい人"),
    ("e005", "2025-08-01", "登壇資料", "テスト自動化の投資対効果", ["テスト自動化", "品質保証"], "QAエンジニア・EM"),
    ("e005", "2026-02-26", "登壇資料", "AI時代のQAの役割", ["品質保証"], "QAエンジニア"),
    ("e005", "2026-09-28", "登壇資料", "テスト自動化の投資対効果 2026", ["テスト自動化"], "QAエンジニア・EM"),
    ("e006", "2025-09-22", "登壇資料", "AIエージェントのプロダクトマネジメント", ["プロダクトマネジメント", "AIエージェント"], "AIプロダクトのPM"),
    ("e006", "2026-04-15", "インタビュー記事", "PMから見たAI Workforce", ["プロダクトマネジメント"], "LayerXに興味がある候補者"),
    ("e007", "2025-12-01", "登壇資料", "金融サービスのクラウドセキュリティ", ["クラウドセキュリティ", "AWS"], "金融系のセキュリティ担当"),
    ("e008", "2025-07-07", "登壇資料", "デザインシステムを育てる", ["デザインシステム", "Figma"], "プロダクトデザイナー"),
    ("e009", "2025-05-26", "登壇資料", "Kubernetesの可観測性入門", ["Kubernetes", "可観測性"], "SRE"),
    ("e028", "2026-06-02", "インタビュー記事", "経費精算のユーザーリサーチで見えたこと", ["ユーザーリサーチ"], "SaaSのPM"),
    ("e030", "2026-03-09", "メンバーのブログ", "Docs as Codeで社内ドキュメントを整える", ["技術ドキュメント", "Docs as Code"], "ドキュメント整備に悩む人"),
    ("e025", "2026-07-14", "メンバーのブログ", "社内ID基盤をゼロトラストに寄せた話", ["ID管理", "ゼロトラスト"], "情シス・セキュリティ担当"),
]
published = []
for i, (a, d, genre, title, tags, reader) in enumerate(sorted(PUB, key=lambda p: p[1]), 1):
    published.append({
        "id": f"pub{i:03d}",
        "title": title,
        "url": f"https://example.com/published/pub{i:03d}",
        "tags": tags,
        "author_id": a,
        "business_unit": emp_by_id[a]["business_unit"],
        "published_at": f"{d}T10:00:00+09:00",
        "genre": genre,
        "target_reader": reader,
        "team": TEAM[a],
    })
dump("published.json", published)

# ---------------------------------------------------------------------------
# schedules — known commitments (conferences, offsites, release crunches)
# ---------------------------------------------------------------------------
schedules = [
    {"employee_id": "e001", "from": "2026-12-14", "to": "2026-12-18", "kind": "海外カンファレンス出張", "note": "米国出張"},
    {"employee_id": "e001", "from": "2027-01-20", "to": "2027-01-22", "kind": "社外登壇", "note": "他社カンファレンスの基調講演"},
    {"employee_id": "e002", "from": "2027-01-27", "to": "2027-01-29", "kind": "オフサイト", "note": "バクラク開発組織の合宿"},
    {"employee_id": "e003", "from": "2027-01-21", "to": "2027-01-21", "kind": "社外登壇", "note": "別のAI勉強会で登壇予定"},
    {"employee_id": "e004", "from": "2027-02-08", "to": "2027-02-12", "kind": "リリース対応", "note": "勘定系の大型リリース"},
    {"employee_id": "e005", "from": "2026-12-14", "to": "2026-12-25", "kind": "リリース対応", "note": "年末リリースの回帰テスト"},
    {"employee_id": "e009", "from": "2027-02-15", "to": "2027-02-19", "kind": "休暇", "note": ""},
    {"employee_id": "e011", "from": "2027-01-04", "to": "2027-01-08", "kind": "休暇", "note": ""},
    {"employee_id": "e013", "from": "2026-12-21", "to": "2026-12-25", "kind": "休暇", "note": ""},
    {"employee_id": "e015", "from": "2026-11-24", "to": "2026-11-30", "kind": "月末対応", "note": "月末バッチの監視当番"},
    {"employee_id": "e015", "from": "2026-12-24", "to": "2026-12-31", "kind": "月末対応", "note": "月末バッチの監視当番"},
    {"employee_id": "e018", "from": "2026-12-16", "to": "2026-12-18", "kind": "研修", "note": "社外の画像認識研修"},
    {"employee_id": "e021", "from": "2027-01-12", "to": "2027-02-27", "kind": "繁忙期", "note": "規制当局への報告準備"},
    {"employee_id": "e024", "from": "2027-02-01", "to": "2027-02-05", "kind": "監査対応", "note": "年次セキュリティ監査"},
]
dump("schedules.json", schedules)

# ---------------------------------------------------------------------------
# surveys — post-event questionnaires (v0.4), exported from Google Forms as CSV.
# data/surveys/{event_id}.csv : first row = the question texts, first column = タイムスタンプ.
# Fictional. The forms collect an optional e-mail and name (example.com / made-up names that are
# not employees) so the import can show that personal columns are dropped.
# Own RNG and written last, so every earlier file stays byte-identical.
# ---------------------------------------------------------------------------
import csv
import io

srng = random.Random(20261201)
Q_TS = "タイムスタンプ"
Q_MAIL = "メールアドレス"
Q_TALK = "どの登壇についての回答ですか？"
Q_RATE = "満足度を教えてください（5：とても満足 〜 1：不満）"
Q_COMMENT = "感想・ご意見があれば自由にお書きください"
Q_NEXT = "次に聞きたいテーマがあれば教えてください"
Q_ROLE = "お仕事の職種を教えてください"
Q_NAME = "お名前（任意）"
Q_HOW = "このイベントを何で知りましたか？"  # no keyword the import knows: shown as an unread column

ROLES = ["バックエンドエンジニア", "フロントエンドエンジニア", "SRE", "QAエンジニア", "EM", "PdM", "MLエンジニア", "学生", "", ""]
ATTENDEE_NAMES = ["山田 花子", "佐藤 健", "高橋 美咲", "伊藤 大輔", "渡辺 さくら", "中村 翔", "小林 結衣", "加藤 直樹"]
HOW = ["connpass", "X（旧Twitter）", "社内の知人", "前回の参加", "ブログ", ""]
NOISE = ["", "", "", "特になし", "なし", "ピザがおいしかったです。", "懇親会も楽しかったです。", "受付がスムーズでした。", "次回も参加したいです。"]
OPS_NEG = [  # complaints about the running of the event
    "会場が寒かったです。",
    "後ろの席だとマイクの音が聞き取りにくかったです。",
    "開始が15分ほど遅れたのが残念でした。",
    "配信の音声が途中で途切れました。",
    "質疑の時間がもっとほしかったです。",
]

# (event_id, speaker_id, talk title, n, rating weights 1..5, positives, content negatives, p_content_neg, wants)
SURVEY_SPEC = [
    ("ev019", "e003", "AIエージェントの本番運用で効くガードレール設計", 22, [0, 0, 1, 5, 16], [
        "ガードレールの具体例が多く、すぐ自分のチームで試せそうでした。",
        "本番で起きた失敗の話がリアルで一番参考になりました。",
        "続編があればぜひ聞きたいです。",
        "人の確認をどこに入れるかの判断基準が分かりやすかったです。",
    ], [
        "後半は駆け足で、メモが追いつきませんでした。",
        "ツール呼び出しの制限のかけ方をもう少し詳しく知りたかったです。",
    ], 0.3, [("ガードレールの続編：本番で起きた失敗と直し方", 6), ("エージェントの回帰テストをCIで回す方法", 4), ("LLMの出力を自動で評価する仕組み", 2), ("", 6)]),
    ("ev019", "e001", "LLMプロダクトのアーキテクチャ選定基準", 14, [0, 1, 4, 7, 2], [
        "アーキテクチャ選定の判断軸が整理されていて参考になりました。",
        "社内でどう合意を取ったかの話が面白かったです。",
    ], [
        "少し抽象的で、具体的な構成図があるとよかったです。",
    ], 0.35, [("実際の構成図とコストの内訳", 2), ("", 8)]),
    ("ev020", "e004", "金融とSaaSでデータ整合性をどう守るか", 19, [1, 5, 8, 4, 1], [
        "整合性をどう守るかの考え方は参考になりました。",
        "二重記帳の図が分かりやすかったです。",
    ], [
        "前提知識が多くて、途中からついていけませんでした。",
        "前提知識が多くて、途中からついていけませんでした。",
        "金融の用語が分からず難しかったです。",
        "スライドの文字が小さくて読めませんでした。",
        "話すのが速くて追いつけませんでした。",
    ], 0.6, [("改ざんを検知できる監査ログの作り方", 5), ("金融システムの整合性の入門編", 4), ("", 6)]),
    ("ev020", "e001", "SaaSと金融のあいだのアーキテクチャ", 13, [0, 0, 3, 7, 3], [
        "SaaSと金融の違いの整理が分かりやすかったです。",
        "規制対応の話をもっと聞きたいと思いました。",
    ], [], 0.0, [("金融規制に合わせた設計の実例", 2), ("", 7)]),
    ("ev017", "e005", "テスト自動化の投資対効果", 15, [0, 0, 2, 9, 4], [
        "テスト自動化の効果を数字で出していて説得力がありました。",
        "自分の会社でも費用対効果の説明に使えそうです。",
    ], [
        "E2Eテストが不安定な問題にどう向き合っているのかが分からなかったです。",
    ], 0.25, [("flakyなE2Eテストの原因の切り分け方", 5), ("テストの費用対効果の測り方", 2), ("", 5)]),
    ("ev017", "e002", "型を入れる順番とチームへの広め方", 12, [0, 1, 3, 6, 2], [
        "型を入れる順番の話が実践的でした。",
        "チームへの広め方が参考になりました。",
    ], [
        "資料が事前に共有されていなかったので、手元で追えませんでした。",
    ], 0.2, [("型の導入をチームに広めた進め方", 2), ("", 7)]),
    ("ev018", "e002", "開発プロセスを週次で見直す振り返りの仕組み", 14, [0, 0, 3, 8, 3], [
        "振り返りの回し方をそのまま真似したいです。",
        "EMの悩みがリアルで共感しました。",
    ], [
        "夜間対応の負担をどう減らしているのかも知りたかったです。",
    ], 0.25, [("夜間のオンコール呼び出しを減らした話", 5), ("振り返りの続編", 2), ("", 5)]),
    ("ev018", "e001", "開発組織とLLM活用", 10, [0, 1, 4, 4, 1], [
        "全体像はつかめました。",
    ], [
        "もう少し具体的な事例がほしかったです。",
    ], 0.4, [("", 8)]),
    ("ev015", "e003", "マルチエージェントの役割分担", 18, [0, 0, 1, 5, 12], [
        "エージェント同士の役割分担の話が具体的で分かりやすかったです。",
        "失敗談が多くて参考になりました、続きが聞きたいです。",
        "続編を希望します。",
    ], [
        "前提が少し難しく、最初の10分は理解が追いつきませんでした。",
    ], 0.2, [("マルチエージェントの続編：本番での失敗と対策", 5), ("", 6)]),
    ("ev015", "e001", "マルチエージェントの設計の選択肢", 12, [0, 1, 3, 6, 2], [
        "設計の選択肢が整理されていました。",
    ], [
        "時間が足りなさそうで、最後が駆け足でした。",
    ], 0.3, [("", 8)]),
    ("ev016", "e001", "生成AIを社内に入れるまで", 24, [0, 2, 6, 12, 4], [
        "生成AIの導入の進め方が参考になりました。",
    ], [
        "スライドを共有してほしいです。",
        "話が広く浅くて、持ち帰れるものが少なかったです。",
    ], 0.3, [("生成AIの社内導入の失敗談", 2), ("", 12)]),
]
# Attacks on a person: shown on the event page, never written to a card. (event, speaker, text, rating)
ATTACKS = [
    ("ev020", "e004", "説明が下手すぎて、聞く価値がありませんでした。", 1),
    ("ev016", "e001", "登壇者にやる気が感じられず、不快でした。", 2),
]
# High score but with a complaint mixed in (always included). (event, speaker, text, rating)
HIGH_BUT = [
    ("ev019", "e003", "内容はとても良かったです。ただ後半は駆け足で、メモが追いつきませんでした。", 5),
    ("ev017", "e005", "数字の出し方は参考になりました。ただ会場が寒くて集中しにくかったです。", 5),
]
# The trend the analysis should find for e004 at ev020 (always included).
TREND = [
    ("ev020", "e004", "前提知識が多くて、途中からついていけませんでした。", 2),
    ("ev020", "e004", "前提知識が多く、金融の用語も分からず難しかったです。", 3),
    ("ev020", "e004", "整合性の考え方は参考になりましたが、前提知識が多くて難しかったです。", 3),
    # complaints about the running of the event (always included)
    ("ev020", "e001", "話は分かりやすかったです。開始が15分ほど遅れたのが残念でした。", 4),
    ("ev019", "e001", "配信の音声が途中で途切れました。", 3),
]


def weighted(pairs):
    return srng.choices([t for t, _ in pairs], weights=[w for _, w in pairs], k=1)[0]


def comment_for(pos, neg, p_neg):
    if srng.random() < 0.3:
        return srng.choice(NOISE)
    if neg and srng.random() < p_neg:
        # complaint only, or a positive sentence followed by a complaint
        parts = [srng.choice(neg)] if srng.random() < 0.5 else [srng.choice(pos), srng.choice(neg)]
    else:
        parts = [srng.choice(pos)]
    if srng.random() < 0.12:
        parts.append(srng.choice(OPS_NEG))
    return "".join(parts)


SURVEY_DIR = OUT / "surveys"
SURVEY_DIR.mkdir(exist_ok=True)
ev_by_id = {e["id"]: e for e in events}
for ev_id in sorted({s[0] for s in SURVEY_SPEC}):
    specs = [s for s in SURVEY_SPEC if s[0] == ev_id]
    multi = len(specs) > 1
    rows = []
    for _, sp, title, n, rw, pos, neg, p_neg, wants in specs:
        talk_label = f"{emp_by_id[sp]['name']}「{title}」"
        own = []
        for _ in range(n):
            rating = srng.choices([1, 2, 3, 4, 5], weights=rw, k=1)[0]
            own.append({"talk": talk_label, "rating": rating, "comment": comment_for(pos, neg, p_neg), "want": weighted(wants)})
        fixed = [(t, r) for (e, s, t, r) in HIGH_BUT + ATTACKS + TREND if e == ev_id and s == sp]
        for i, (t, r) in enumerate(fixed):
            own[i * 3 + 1].update(comment=t, rating=r)
        rows += own
    srng.shuffle(rows)
    y, m, dd = ev_by_id[ev_id]["date"].split("-")
    header = [Q_TS, Q_MAIL] + ([Q_TALK] if multi else []) + [Q_RATE, Q_COMMENT, Q_NEXT, Q_ROLE, Q_NAME] + ([Q_HOW] if ev_id == "ev020" else [])
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    minute = 0
    for r in rows:
        minute += srng.randint(1, 9)
        stamp = f"{y}/{m}/{dd} {21 + minute // 60}:{minute % 60:02d}:{srng.randint(0, 59):02d}"
        mail = f"attendee{srng.randint(100, 999)}@example.com" if srng.random() < 0.25 else ""
        name = srng.choice(ATTENDEE_NAMES) if srng.random() < 0.15 else ""
        line = [stamp, mail] + ([r["talk"]] if multi else []) + [str(r["rating"]), r["comment"], r["want"], srng.choice(ROLES), name]
        if ev_id == "ev020":
            line.append(srng.choice(HOW))
        w.writerow(line)
    (SURVEY_DIR / f"{ev_id}.csv").write_text(buf.getvalue(), encoding="utf-8", newline="\n")
# calendar — hour-level fictional appointments, used to COMPUTE busyness
# (lib/busyness.ts). Only start / end / all_day: no titles, places or attendees.
# Added at the end with its own seed, so every file above stays byte-identical.
# The fill rate loosely follows the old fictional workload so the demo keeps the
# same story (e002・e015 are packed, e012 has room); the number shown to users is
# what lib/busyness.ts computes from these appointments, not the old workload.
# ---------------------------------------------------------------------------
cal_rng = random.Random(20261122)
CAL_FROM = date(2026, 11, 23)
CAL_TO = date(2026, 12, 31)
FILL = {1: 0.12, 2: 0.24, 3: 0.42, 4: 0.56, 5: 0.72}
SLOTS = 18  # 10:00-19:00 in 30-minute slots
calendar = []
for e in EMP:
    eid, busy = e[0], e[6]
    base = FILL[busy] + cal_rng.uniform(-0.05, 0.05)
    d = CAL_FROM
    while d <= CAL_TO:
        if d.weekday() < 5:
            want = round(max(0.0, min(0.95, base + cal_rng.uniform(-0.15, 0.15))) * SLOTS)
            taken = [False] * SLOTS
            filled, tries = 0, 0
            while filled < want and tries < 200:
                tries += 1
                length = cal_rng.choice([1, 2, 2, 3, 4])
                start = cal_rng.randrange(0, SLOTS - length + 1)
                if any(taken[start:start + length]) or filled + length > want + 1:
                    continue
                for i in range(start, start + length):
                    taken[i] = True
                filled += length
            i = 0
            while i < SLOTS:  # merge adjacent slots into one appointment
                if not taken[i]:
                    i += 1
                    continue
                j = i
                while j < SLOTS and taken[j]:
                    j += 1
                def hm(k):
                    m = 10 * 60 + k * 30
                    return f"{m // 60:02d}:{m % 60:02d}"
                calendar.append({"employee_id": eid, "start": f"{d}T{hm(i)}:00+09:00", "end": f"{d}T{hm(j)}:00+09:00", "all_day": False})
                i = j
        d += timedelta(days=1)
dump("calendar.json", calendar)

# answer key for README (printed, not written to JSON)
print("GEMS")
for aid, a, th in gem_answer:
    print(aid, a, emp_by_id[a]["name"], th)
print("SHARED", shared_ids)
