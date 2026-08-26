# V6 実装ロードマップ・依存関係・PR分割

更新日: 2026-08-26
前提: V5の修正済み260画面をV6として複製し、32機能の要件定義を完了。要件監査後のV6追加編集・コード・DB変更はない

## 0. 結論

実装の受け入れ単位は**1機能**、開発管理は**1機能1親Issue**とする。ただし、DB・API・画面・移行を一つの巨大PRへ詰めない。1機能を2〜4個の小さなPRで縦に通し、親Issueの受け入れ条件が全部そろった時にその機能を完了とする。

```text
親Issue: 18 流入と計測
├─ PR A: schema・shadow backfill
├─ PR B: API・実行・権限
├─ PR C: V6画面・状態・遷移
└─ PR D: cutover・旧read停止・証拠
```

小規模機能はA〜Cを一つにできる。金額、通知、外部副作用、個人情報を扱う機能は分ける。

## 1. 実装開始前の停止条件

現在のrepositoryはV5共通基盤等の未整理変更がある無関係branch上にあるため、実装開始は停止する。最初に次を完了する。

1. 既存変更A〜Dの所有者・用途を確定
2. 調査資料、V3 menu修正、V5共通基盤を専用branch/PRへ整理
3. `origin/codex/development`から最新専用branchを作る
4. 親・LINE作業treeがcleanであることを確認
5. V6実Node ID、1920px設計画像、対象状態一覧をIssueへ固定

この5点を満たすまでV6コード実装、DB migration、配備を始めない。

## 2. Wave 0: 緊急安全修正

V6実装と分け、現行利用者の漏えい・誤動作を先に止める。

| 優先 | 対象 | 修正 |
|---:|---|---|
| P0 | 22写真 | LIFF採用写真をcurrent friendで絞る |
| P0 | 22写真 | 管理写真一覧・公開galleryをaccount/publication scopeで絞る |
| P0 | 30権限 | 未分類APIを許可しない方針へ切替 |
| P0 | 32停止 | localStorageではなくserver側dispatcher gateを用意 |
| P0 | 26外部 | 平文secret、SSRF、replayの経路を閉じる |

各修正は再現test付きの独立PR。V6画面変更を混ぜない。

## 3. Wave 1: 共通基盤

依存順:

1. Scope＋authorization（30）
2. Versioning＋audit
3. Server feature gate（31）
4. Operations gate・monitor（32）
5. Receipt/domain event（23/26/20）
6. Action catalog/execution/Queue（25）
7. Secret/connectors（26）
8. Media asset（15）
9. Metrics/read model（20）

Wave 1完了条件:

- accountなしqueryを禁止
- deny-by-default
- published version不変
- event/action冪等
- server kill switch
- private media original
- metric freshness

## 4. Wave 2: LINE管理の中核

| 順 | 機能 | 依存 |
|---:|---|---|
| 1 | 4 友だち属性 | Scope、audit |
| 2 | 3 友だち | 4、Scope、PII |
| 3 | 14 共通情報 | Versioning、Scope |
| 4 | 15 登録メディア | Media基盤 |
| 5 | 11 テンプレート | 14、15、Versioning |
| 6 | 13 回答フォーム | 4、11、Versioning、Event |
| 7 | 12 リッチメニュー | 4、15、Versioning |
| 8 | 2 受信箱 | 3、4、11、delivery ledger |

Wave 2で、配信機能が参照するfriend、condition、content、mediaを固める。

## 5. Wave 3: 配信5機能

共通送信基盤を一度作り、機能はtrigger/UIだけ分ける。

| 順 | 機能 | 理由 |
|---:|---|---|
| 1 | 6 一斉配信 | audience snapshotと送信batchの基準 |
| 2 | 9 友だち追加時配信 | 単純triggerでversion/jobを検証 |
| 3 | 8 自動応答 | 競合優先順位・再帰防止 |
| 4 | 7 リマインダ | timezone・予約・取消 |
| 5 | 5 シナリオ配信 | 分岐・待機・切替を最後に統合 |

各機能で、test送信、quota、opt-out、skipped、retry、永久失敗、kill switchを同じ受け入れtestで確認する。

## 6. Wave 4: 成果・計測・分析

| 順 | 機能 | 依存 |
|---:|---|---|
| 1 | 19 コンバージョン | Domain event、Versioning |
| 2 | 18 流入と計測 | 19、connector、secret |
| 3 | 17 マイル・スコア | 19、Action、ledger |
| 4 | 16 成果・アフィリエイト | 18、19、ledger、PII |
| 5 | 20 分析UI | 全metric projection |

20のevent/aggregate基盤はWave 1、画面と保存分析はWave 4に分ける。分析を先に見た目だけ作らない。

## 7. Wave 5: 予約

| 順 | 機能 | 依存 |
|---:|---|---|
| 1 | 28 予約設定 | resource/calendar/version |
| 2 | 27 予約管理 | 28、通知、action、calendar adapter |
| 3 | 29 イベント予約 | 27共通contact、capacity/waitlist |

27代理予約はV6 P0導線として最初のend-to-endに含める。Google Meet個別相談はevent ID、friend ID、日時、Meet URLを相談APIへ登録し、前日・1時間前LINE reminderを必須にする。

## 8. Wave 6: 独自・外部依存

| 順 | 機能 | 依存・条件 |
|---:|---|---|
| 1 | 23 EC連携 | connector/event/action基盤 |
| 2 | 24 LINE通知 | delivery ledger、23/予約event。顧客・運用者を分離 |
| 3 | 21 NEN配信 | 23 normalized event、24、coupon/point adapter |
| 4 | 22 写真審査 | Media、同意、EC point adapter |
| 5 | 10 ウェビナー | Media、Event、動画方式確定 |
| 6 | 25 オートメーションUI | 共通基盤はWave 1、画面・見本・利用先を完成 |
| 7 | 26 外部連携UI | 基盤はWave 1、mapping・履歴・公開APIを完成 |

## 9. Wave 7: 統合画面

| 順 | 機能 | 条件 |
|---:|---|---|
| 1 | 31 機能設定UI | 各機能の依存・停止意味が確定 |
| 2 | 32 運用状態UI | 全dispatcher/connector/aggregateがhealthを出す |
| 3 | 1 ダッシュボード | 各機能のaggregate/freshnessが揃う |

backend gateはWave 1、画面完成は最後とする。

## 10. 機能別PRの標準形

### PR A: データ・移行準備

- additive schema
- index/constraint
- legacy inventory query
- dry-run/backfill script
- row/hash/amount reconciliation
- rollback path

### PR B: API・実行

- scoped repository/service
- permission
- idempotency/version conflict
- Queue/retry/reconcile
- unit/integration/security test

### PR C: V6画面

- actual Node ID
- 主要操作・全状態・遷移
- 1440/1920
- accessibility
- same-width image comparison

### PR D: 切替

- shadow result
- canary
- feature flag
- cutover/rollback evidence
- old write停止
- release log

## 11. 1PRを大きくしない基準

次のいずれかを超えたら分割する。

- schema/API/UIの3層すべてが大規模
- 外部副作用が2種類以上
- migrationとfeature cutoverを同時実行
- security boundaryと画面変更が混在
- reviewで一つの失敗原因に戻せない

一方、空状態追加、button名、1つの既存API配線等は機能PRへまとめてよい。

## 12. 各Waveの完了ゲート

- latest `codex/development`を取り込み、SHAを記録
- typecheck、test、build、diff検査
- mandatory check成功、mergeable/CLEAN
- migrationはbackup→dry-run→reconciliation→承認→実行
- code deployとDB更新を別工程
- 反映後smoke、Queue、error、metricsを確認
- worktree clean
- release logを利用者向け文言で追加
- V6画像比較と受け入れ証拠をIssueへ集約

## 13. 完了の定義

32機能が「完了」となるのは、画面がある時ではなく、次の全てがそろった時である。

- DB/API/画面が縦に通る
- 既存データが照合済み
- external副作用が冪等・再試行・reconcile可能
- 全状態と権限をtest
- V6と画像一致
- 本番前承認資料とrollbackがある

要件定義完了は実装完了ではない。現在は実装を安全に始められる設計完了地点である。
