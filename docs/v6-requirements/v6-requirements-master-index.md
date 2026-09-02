# V6 全32機能 要件定義 正本索引

更新日: 2026-08-26
状態: **32 / 32 完了**
対象外: V6複製後の追加デザイン変更、コード変更、DB更新、本番反映

## 1. 結論

全32機能は要件定義へ進める品質にある。Pencil上の**V6実Node 260画面**を機能別に再集計し、32本の要件で実Node IDを固定した。V6の画面構造は原則採用する。ただし、画面に描かれた数字・自動処理・連携が現行データで実現できるとは限らないため、各要件で次を分けた。

版の正本は**V6**とする。V5の260画面はV6と一対一で一致する旧版のため、backup後に廃止する。詳細は[正本化の決定](./v6-canonical-design-decision.md)を参照する。

- そのまま実装できるもの
- 既存DB/APIを安全に拡張すれば実装できるもの
- 外部契約・API仕様が決まれば実装できるもの
- 取得不能または危険なので除外するもの

採点の範囲は、V6 UI/UXが概ね94〜99点、Lステップ・Liny等への対抗力が概ね94〜100点である。現行実装完成度は38〜91点、データ安全性は21〜79点と差が大きい。したがって、見た目を一括載せ替えするのではなく、共通安全基盤を先に作り、機能単位で縦に通す。

## 2. 32機能の索引

| # | 機能 | 要件定義 | 実装前の主な条件 |
|---:|---|---|---|
| 1 | ダッシュボード | [詳細](./v6-01-dashboard-requirements-draft.md) | 共通集計、鮮度、account境界。各機能の後に仕上げる |
| 2 | 受信箱 | [詳細](./v6-02-inbox-requirements-draft.md) | 担当・対応状態・検索・権限・送受信台帳 |
| 3 | 友だち | [詳細](./v6-03-friends-requirements-draft.md) | account境界、PII、重複候補、CSV |
| 4 | 友だち属性 | [詳細](./v6-04-friend-attributes-requirements-draft.md) | schemaとvalueの分離、削除影響、監査 |
| 5 | シナリオ配信 | [詳細](./v6-05-scenario-delivery-requirements-draft.md) | 公開版、待機job snapshot、共通送信台帳 |
| 6 | 一斉配信 | [詳細](./v6-06-broadcast-requirements-draft.md) | audience snapshot、枠、停止、再送防止 |
| 7 | リマインダ | [詳細](./v6-07-reminder-requirements-draft.md) | 起点時刻、timezone、版、取消 |
| 8 | 自動応答 | [詳細](./v6-08-auto-reply-requirements-draft.md) | 競合優先順位、再帰防止、実行台帳 |
| 9 | 友だち追加時配信 | [詳細](./v6-09-friend-add-delivery-requirements-draft.md) | follow/refollow、account、版、重複防止 |
| 10 | ウェビナー | [詳細](./v6-10-webinar-requirements-draft.md) | 動画方式、公開版、視聴計測の限界 |
| 11 | テンプレート | [詳細](./v6-11-template-requirements-draft.md) | content version、利用先、媒体検査 |
| 12 | リッチメニュー | [詳細](./v6-12-rich-menu-requirements-draft.md) | 画像版、表示条件、LINE反映差分 |
| 13 | 回答フォーム | [詳細](./v6-13-response-form-requirements-draft.md) | 公開版、回答snapshot、同意、失敗回復 |
| 14 | 共通情報 | [詳細](./v6-14-common-information-requirements-draft.md) | 共通値と個別override、secret非格納 |
| 15 | 登録メディア | [詳細](./v6-15-media-library-requirements-draft.md) | private原本、派生asset、参照・削除 |
| 16 | 成果・アフィリエイト | [詳細](./v6-16-affiliate-requirements-draft.md) | 報酬台帳、締め、口座、会計判断 |
| 17 | マイル・行動スコア | [詳細](./v6-17-mileage-score-requirements-draft.md) | 2概念分離、版、冪等、交換原子性 |
| 18 | 流入と計測 | [詳細](./v6-18-inflow-measurement-requirements-draft.md) | site key、広告secret、送信冪等、費用取込 |
| 19 | コンバージョン | [詳細](./v6-19-conversion-requirements-draft.md) | 共通event、attribution、金額snapshot |
| 20 | 分析 | [詳細](./v6-20-analytics-requirements-draft.md) | 読取event、日別集計、時系列、保存snapshot |
| 21 | NEN配信 | [詳細](./v6-21-nen-delivery-requirements-draft.md) | EC起点、版、job snapshot、coupon saga |
| 22 | 写真審査 | [詳細](./v6-22-photo-review-requirements-draft.md) | privacy修正、人の最終判断、同意、point saga |
| 23 | EC連携 | [詳細](./v6-23-ec-integration-requirements-draft.md) | connector、未照合identity、event/action台帳 |
| 24 | LINE通知 | [詳細](./v6-24-line-notification-requirements-draft.md) | 顧客/運用者を分離、共通送信台帳 |
| 25 | オートメーション | [詳細](./v6-25-automation-requirements-draft.md) | 共通action、公開版、実行snapshot、retry |
| 26 | 外部連携 | [詳細](./v6-26-external-integrations-requirements-draft.md) | secret暗号化、SSRF/replay防止、Queue |
| 27 | 予約管理 | [詳細](./v6-27-booking-management-requirements-draft.md) | 代理予約、競合、通知、Google同期 |
| 28 | 予約設定 | [詳細](./v6-28-booking-settings-requirements-draft.md) | menu/resource/calendar版、例外日 |
| 29 | イベント予約 | [詳細](./v6-29-event-booking-requirements-draft.md) | 定員、待ち、期限付き繰上げ、通知 |
| 30 | ログインユーザー | [詳細](./v6-30-login-users-requirements-draft.md) | deny-by-default、三段階権限、session失効 |
| 31 | 機能設定 | [詳細](./v6-31-feature-settings-requirements-draft.md) | 契約/会社/個人を分離、server強制 |
| 32 | 運用状態 | [詳細](./v6-32-operations-status-requirements-draft.md) | server監視、kill switch、復旧、追記履歴 |

## 3. 実装判断

### 実装する

- 全32機能の主タスクと、V6に描かれた実現可能な状態
- 共通部品、版、event、action、job、audit、account境界
- 既存データを履歴として残した段階移行
- 1440px・1920pxの画像比較と遷移確認

### 条件付きで実装する

| 領域 | 条件 |
|---|---|
| 動画 | 管理動画と外部動画の方式を分け、外部動画の個人視聴区間は出さない |
| 広告 | 各広告APIの契約・token・event mappingが確定した接続先だけ |
| EC | provider adapterと利用shopのscopeが確定した接続先だけ |
| 決済 | providerを選定し、取消・返金・webhook・冪等を別要件で確定後 |
| Google Calendar | 既存認証・event ID・双方向競合規則を固定後 |
| 写真AI | 人の確認補助だけ。公開・不採用を自動確定しない |
| 税・源泉 | 法務・会計確認後。初期は入力・表示・明細まで |

### 除外する

- LINE個人単位の既読・未読・到達保証
- follow eventだけからの正確な流入経路判定
- 送信済みLINEメッセージの取消
- 名前だけ、AI類似度だけによる人物の自動名寄せ
- 外部providerと自社DBを単一transactionとみなすこと
- 公開済み定義や確定金額の直接上書き
- 履歴・監査・支払・審査記録の物理削除
- 外部動画URLからの正確な個人視聴区間取得
- 到着eventなしの配送到着断定
- AIだけによる写真公開・不採用、顔による本人特定
- 相関を因果として断定する分析
- 取得できない数値を0として表示
- 無限再試行、成功済み副作用の強制再送
- この管理画面からの銀行振込実行

## 4. 要件定義から実装へ渡せる状態か

**渡せる。** ただし、32機能を同時に画面実装へ渡すのではなく、次の5点を共通正本にしてから機能別Issueへ切る。

1. organization / LINE account / friend / operatorの境界
2. definition / version / publication / snapshot
3. receipt / domain event / action execution / job attempt
4. 権限、監査、secret、PII、同意
5. 移行、shadow実行、cutover、rollback、画像比較

共通正本は[横断整合レビュー](./v6-32-feature-cross-review.md)と[共通基盤要件](./v6-shared-platform-requirements.md)にまとめる。

## 5. 次工程の成果物

- [横断整合レビュー](./v6-32-feature-cross-review.md)
- [共通基盤要件](./v6-shared-platform-requirements.md)
- [実装ロードマップ](./v6-implementation-roadmap.md)
- [データ移行・API・受け入れテスト計画](./v6-data-api-migration-acceptance-plan.md)
- [進捗台帳](./v6-32-feature-requirements-progress.md)
