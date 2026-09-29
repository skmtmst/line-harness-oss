# V6 全34機能 要件定義進捗台帳

更新日: 2026-09-03

## 1. 現在地

- 要件定義: **34 / 34機能 完了**(2026-09-03 に 33 アカウント設定、34 はじめの設定と案内 を追加。01 と 25 を書き直し、横断契約を 1 本化)
- V6設計: **32 / 32機能・260画面を正本化済み**(33・34 の追加画面は横断レビュー §7 でPencilへ依頼中)
- **実装と画像比較の進捗は、この台帳では持たない。** 正本は `docs/design-qa/v6-progress-ledger.md`(`scripts/visual-qa/screens.mjs` から機械生成)である。この台帳の実装列は 2026-08-27 で更新が止まり、実態より大幅に低く見えていたため、列ごと廃止した
- リポジトリ: **34本の要件文書と次工程文書をgitへ格納済み**
- 要件の根拠: V6、現行コード・DB・API、Lステップ・Liny調査

各詳細要件には、採点、主タスク、画面、データ、API、権限、移行、Lステップとの差、除外、完了条件、実装順を含む。

## 2. 全34機能の要件定義と設計の進捗

### 2-1. 見かた

- **要件定義 完了**: データ、API、権限、移行、除外、完了条件まで記載済み
- **V6設計 完了**: ★V6の実Node IDを正本として割り当て済み
- 実装・画像確認の列は廃止。`docs/design-qa/v6-progress-ledger.md` を見る

| # | 機能 | 要件定義 | V6設計 | 詳細要件 |
|---:|---|---|---|---|
| 1 | ダッシュボード | ✅ 完了 | ✅ 完了 | `v6-01-dashboard-requirements-draft.md` |
| 2 | 受信箱 | ✅ 完了 | ✅ 完了 | `v6-02-inbox-requirements-draft.md` |
| 3 | 友だち | ✅ 完了 | ✅ 完了 | `v6-03-friends-requirements-draft.md` |
| 4 | 友だち属性 | ✅ 完了 | ✅ 完了 | `v6-04-friend-attributes-requirements-draft.md` |
| 5 | シナリオ配信 | ✅ 完了 | ✅ 完了 | `v6-05-scenario-delivery-requirements-draft.md` |
| 6 | 一斉配信 | ✅ 完了 | ✅ 完了 | `v6-06-broadcast-requirements-draft.md` |
| 7 | リマインダ | ✅ 完了 | ✅ 完了 | `v6-07-reminder-requirements-draft.md` |
| 8 | 自動応答 | ✅ 完了 | ✅ 完了 | `v6-08-auto-reply-requirements-draft.md` |
| 9 | 友だち追加時配信 | ✅ 完了 | ✅ 完了 | `v6-09-friend-add-delivery-requirements-draft.md` |
| 10 | ウェビナー | ✅ 完了 | ✅ 完了 | `v6-10-webinar-requirements-draft.md` |
| 11 | テンプレート | ✅ 完了 | ✅ 完了 | `v6-11-template-requirements-draft.md` |
| 12 | リッチメニュー | ✅ 完了 | ✅ 完了 | `v6-12-rich-menu-requirements-draft.md` |
| 13 | 回答フォーム | ✅ 完了 | ✅ 完了 | `v6-13-response-form-requirements-draft.md` |
| 14 | 共通情報 | ✅ 完了 | ✅ 完了 | `v6-14-common-information-requirements-draft.md` |
| 15 | 登録メディア | ✅ 完了 | ✅ 完了 | `v6-15-media-library-requirements-draft.md` |
| 16 | 成果・アフィリエイト | ✅ 完了 | ✅ 完了 | `v6-16-affiliate-requirements-draft.md` |
| 17 | マイル | ✅ 完了 | ✅ 完了 | `v6-17-mileage-score-requirements-draft.md` |
| 18 | 流入と計測 | ✅ 完了 | ✅ 完了 | `v6-18-inflow-measurement-requirements-draft.md` |
| 19 | コンバージョン | ✅ 完了 | ✅ 完了 | `v6-19-conversion-requirements-draft.md` |
| 20 | 分析 | ✅ 完了 | ✅ 完了 | `v6-20-analytics-requirements-draft.md` |
| 21 | NEN配信 | ✅ 完了 | ✅ 完了 | `v6-21-nen-delivery-requirements-draft.md` |
| 22 | 写真審査 | ✅ 完了 | ✅ 完了 | `v6-22-photo-review-requirements-draft.md` |
| 23 | EC連携 | ✅ 完了 | ✅ 完了 | `v6-23-ec-integration-requirements-draft.md` |
| 24 | LINE通知 | ✅ 完了 | ✅ 完了 | `v6-24-line-notification-requirements-draft.md` |
| 25 | オートメーション | ✅ 完了 | ✅ 完了 | `v6-25-automation-requirements-draft.md` |
| 26 | 外部連携 | ✅ 完了 | ✅ 完了 | `v6-26-external-integrations-requirements-draft.md` |
| 27 | 予約管理 | ✅ 完了 | ✅ 完了 | `v6-27-booking-management-requirements-draft.md` |
| 28 | 予約設定 | ✅ 完了 | ✅ 完了 | `v6-28-booking-settings-requirements-draft.md` |
| 29 | イベント予約 | ✅ 完了 | ✅ 完了 | `v6-29-event-booking-requirements-draft.md` |
| 30 | ログインユーザー | ✅ 完了 | ✅ 完了 | `v6-30-login-users-requirements-draft.md` |
| 31 | 機能設定 | ✅ 完了 | ✅ 完了 | `v6-31-feature-settings-requirements-draft.md` |
| 32 | 運用状態 | ✅ 完了 | ✅ 完了 | `v6-32-operations-status-requirements-draft.md` |
| 33 | アカウント設定 | ✅ 完了 | 🟠 Pencil追加待ち | `v6-33-account-settings-requirements-draft.md` |
| 34 | はじめの設定と案内 | ✅ 完了 | 🟠 Pencil追加待ち | `v6-34-onboarding-guidance-requirements-draft.md` |

> 実装の「完了」は、各要件書のV6完了条件(検証できる文だけ)を全て満たしたかで判定する。画像比較は共通工程ゲート(共通基盤要件 §10)で別に担保する。件数は `docs/design-qa/v6-progress-ledger.md` を見る。

## 3. 要件定義を完了した順

### A. LINE中核を閉じる（完了）

15 登録メディアまで完了。配信・テンプレートが参照するメディアの版、URL、利用先、削除、直接アップロードを固定した。

### B. 成果と予約を閉じる

19 コンバージョンまで完了。

28 予約設定まで完了。

29 イベント予約まで完了。

理由: 18の流入、20の分析、27の予約管理へ接続する終点を固める。

### C. 権限・障害・外部接続を閉じる

30 ログインユーザーまで完了。認証・権限の最重要条件を、未分類API拒否、三段階権限、項目マスク、session即時失効、共通監査として固定した。

26 外部連携まで完了。組織境界、暗号化secret、replay/SSRF防止、Queue、配送台帳、受信mapping、公開APIを固定した。

32 運用状態まで完了。server Cron、kill switch、dispatcher gate、停止中job、drift付き復旧、追記履歴をP0として固定した。

31 機能設定まで完了。契約、会社設定、個人権限、緊急停止を分離し、サーバ側強制、依存確認、原子保存を固定した。

### D. 独自・外部依存領域を閉じる

1 ダッシュボードまで完了。account境界、カードごとの期間・鮮度・失敗状態、server保存の個人配置、共通通知、QRを固定した。

10 ウェビナーまで完了。管理動画と外部動画の分析差、公開版、視聴segment、通知・action、account境界、archiveを固定した。

16 成果・アフィリエイトまで完了。tenant境界、案件・報酬snapshot、承認・保留・締め・調整の追記台帳、口座暗号化、振込CSVまで固定した。

21 NEN配信まで完了。account境界、実測/予定trigger、公開版とjob snapshot、birthday/coupon saga、取得可能な反応指標を固定した。

22 写真審査まで完了。人の最終判断、公開同意、private original、派生画像、ポイント版とreconciliationを固定した。

23 EC連携まで完了。connector/account境界、未照合identity、event/action台帳、定期便risk、既存EC-CUBE移行を固定した。

理由: 共通イベント・権限・外部接続を参照する領域。外部サービス契約が未確定でも、推奨既定値と除外を明記して要件定義は完了させる。

## 4. 全機能共通の実装ゲート

- 公開済み定義を直接上書きせず、版を固定する
- 外部送信・アクション・Webhookは冪等キーを持つ
- 実行台帳で成功、スキップ、再試行、恒久失敗を分ける
- アカウント境界とサーバ側権限を保証する
- 既存データを先に棚卸しし、ある機能を新規作成と書かない
- 移行はバックアップ、dry-run、件数照合、新旧二重実行防止を行う
- 1440px・1920pxで主要画面に横スクロールを出さない
- 空、読込、エラー、権限不足、失敗、競合を定義する
- 表示するボタンは動作し、`準備中`を残さない
- V6実Node ID、設計画像、同幅の実装画像をPRに固定する

## 5. 現時点で除外が確定した代表項目

- LINEの個人単位の既読・未読取得
- followイベントだけからの正確な流入経路判定
- 送信済みLINEメッセージの取消
- 公開済み定義の直接上書き
- 失敗を成功扱いにすること
- 複数ルールやアクションの暗黙同時実行
- 外部サービスへの無限再試行
- 名前だけによるEC顧客の自動名寄せ
- 自前の動画配信基盤
- 人の最終判断なしの写真審査自動承認

## 6. 要件定義完了後の次工程

次工程の文書化も完了した。

1. 32本の横断レビューと用語・状態・API統一: `v6-32-feature-cross-review.md`
2. 共通基盤の実装仕様: `v6-shared-platform-requirements.md`
3. 機能ごとの依存関係・Wave・PR順: `v6-implementation-roadmap.md`
4. 既存データ移行・API・E2E・画像比較・Go/No-Go: `v6-data-api-migration-acceptance-plan.md`
5. 全32機能の索引・実装/条件付き/除外: `v6-requirements-master-index.md`

PencilのV6実Nodeは32機能・260画面で再集計し、詳細要件内のV5由来Node参照をV6実Node IDへ更新した。

実装は開始済み。機能ごとの実装と画像比較の現在値は `docs/design-qa/v6-progress-ledger.md` を見る。次は各機能を要件書の完了条件(検証できる文だけ)に沿って縦に通す。
