# LINE Harness V6 指示書(Claude / Codex 用・第 2 版)

作成 2026-09-03。第 1 版(2026-09-02)からの変更点: 要件定義の見直しが PR #690 として出たこと、V6 の Pencil 設計そのものの採点(6/10)と Pencil 側の修正一覧が加わったこと、担当の順番を「要件 → Pencil → 実装」に組み替えたこと。

## 0. いま何が決まっていて、何が待ちか

| 項目 | 状態 | 場所 |
|---|---|---|
| 要件定義 34 本 | 見直し済み。「人の判断が要る点」4 件は 2026-09-03 に決定し PR #690 のコメントに記録。マージ後は codex/development が正本 | docs/v6-requirements/、PR https://github.com/skmtmst/line-harness-oss/pull/690 |
| 横断契約(アクション一覧、版の 2 分類、権限、再試行、未取得表示、工程ゲート) | 1 本化済み。正本は索引 §5 の表 | docs/v6-requirements/v6-requirements-master-index.md §5 |
| Pencil への修正依頼 | 50 件を集約済み(1〜29 要件由来、30〜50 設計画像由来)。反映は未 | docs/v6-requirements/v6-32-feature-cross-review.md §7 |
| Pencil 設計の採点 | 6 / 10。直すべき点 21 件 | 評価ページ「Pencil 設計の採点」 |
| 実装と画像比較の進捗 | 262 画面中 一致 58 | docs/design-qa/v6-progress-ledger.md(機械生成) |

## 1. 共通の前提(両方に渡す)

- ゴールは Pencil の ★V6 と要件書どおりに仕上げ、Lステップを超えること。
- 正本の順位: Pencil ★V6 → docs/v6-common-rules.md → 要件書(索引 §5 の横断契約が機能別より優先) → 共通部品 → 契約テスト。
- 進捗の正本は docs/design-qa/v6-progress-ledger.md。要件側の進捗台帳は要件と設計の完了だけを持つ。
- ファイル所有:
  - Claude: docs/v6-requirements/、scripts/visual-qa/、docs/design-qa/、docs/design-reference/、apps/web/src/components/shared/、Pencil
  - Codex: apps/worker/src/routes、apps/worker/src/services、packages/db、.github/、apps/web/src/lib/api.ts の分割
  - 相手の領域を触るときは Slack のスレッドで先に宣言する。
- release-log は docs/release-log/unreleased/<PR番号>-<担当>-<内容>.md に書き、PR 番号を採番後に足して push する。
- オープン PR が 20 本を超えている間は、新規 PR を出す前に自分の古い PR を閉じるか統合する。
- DB 更新と配備は Claude の週次スロットに集約する。Codex はドライランまで。

## 2. Claude Code へ

```
目的: LINE Harness を Pencil の ★V6 と要件どおりに仕上げる。担当は「要件 → Pencil → 設計一致 → 安全」。
正本: docs/v6-requirements/v6-requirements-master-index.md §5 の横断契約、docs/v6-common-rules.md、docs/design-qa/v6-progress-ledger.md。
所有: docs/v6-requirements/、scripts/visual-qa/、docs/design-qa/、components/shared/、Pencil。routes / services / packages/db は Codex の領域。

今週の順番:
1. PR #690(要件見直し)がマージ済みであることを確認し、最新の codex/development を取り込んでから始める。判断 4 件の結論は PR #690 のコメントにある。
2. Pencil の ★V6 に、横断レビュー §7 の 50 件(1〜29 は要件由来、30〜50 は設計画像の確認由来。優先度順)を反映する。反映した画面は html-css で書き出し直し、docs/design-reference/ を更新し、その画面の判定を未判定に戻す。
3. docs/design-reference/ に無い機能(4、9〜32)の設計画像を Pencil から書き出して揃える。設計画像が無い機能は一致判定ができない。
4. 安全修正の独立 PR: apps/worker/src/routes/stripe.ts:91-104 の秘密未設定パスを 503 に。site-tracking.ts:212 / affiliates.ts:375 / rich-menus.ts:85-207 / images.ts:99 にアカウント境界チェック。route-guard-coverage.test.ts に「:id / :friendId を持つルートは境界関数を呼ぶ」検査。
5. 共通部品の横断差し替え: PageHeader と StickyBar を 130 ページへ、素の select を shared/select へ、list-toolbar.tsx の「準備中」を全廃(動くまで描かない)。1 部品 1 PR。契約テストで「page.tsx が h1 と select を直接持たない」「準備中を含まない」を機械で禁止する。
6. screens.mjs の verdictNote から不足部品を抽出し、部品 → 影響画面数 の表を台帳に足す。上位 5 部品から直す。

守ること: 1 PR = 1 部品または 1 修正。「一致」は文言一致 + 寸法一致 + 全状態撮影済みのときだけ。Pencil を直す前にコードを直さない。
```

## 3. Codex へ

```
目的: LINE Harness を V6 どおりに仕上げるための「API・性能・段取り」を担当する。画面の見た目と要件書は Claude の領域なので触らない。
所有: apps/worker/src/routes, services, packages/db, .github/、apps/web/src/lib/api.ts の分割。screens.mjs、components/shared、docs/v6-requirements は触らない。
読むもの: docs/v6-requirements/v6-25-automation-action-contract.md(共通アクションの正本)、v6-shared-platform-requirements.md §6-2(再試行)と §9(未取得)と §10(工程ゲート)、v6-30 §7〜§8(権限の正本)。

今週の順番:
1. apps/worker/wrangler.toml:29 の crons と index.ts:1298,1433,1452 の '* * * * *' 条件の不一致を、本番 Cron Trigger の実設定を確認したうえで揃える。
2. AGENTS.md 71・82 行目の release-log 記述を per-PR ファイル方式に書き換え、ファイル所有表(Claude / Codex)を追記する。
3. 生成物を PR の差分から外す: packages/db/bootstrap.sql と bootstrap-meta.json は生成して使う。design-impact.test.ts の 81 パス完全一致は件数検査に。各ベースライン JSON は「増えていない」だけを検査。
4. packages/db/src/scenarios.ts:591 getFriendScenariosDueForDelivery に next_delivery_at <= ? と LIMIT を入れる。前提として保存形式を 1 つに正規化するマイグレーション(dry-run 付き)。
5. 全一覧 API の limit を共通ミドルウェアで上限 200 にクランプ(routes/friends.ts:151 など)。
6. 権限の deny-by-default: v6-30 §8 のとおり、route metadata の無い管理 API を CI で落とす。permission key の命名は各要件書の権限章の表に合わせる。
7. 未実装 28 画面のうち API 待ち 8 件(uid_migration、写真審査、EC 接続先、締め台帳、定期レポート)とルート不在 8 件(auto-replies/publish など)のバックエンドを、接続契約のカタログ名で実装する。
8. required-pr-gate.yml と worker-ci.yml に concurrency(cancel-in-progress)を足し、worker-ci の重複ステップを外す。

守ること: 1 PR 中央値 10 ファイル以内。再試行回数を独自に決めない(共通基盤 §6-2)。未取得を 0 と返さない(§9)。DB 更新・配備はドライランまで。
```

## 4. 人が決めること(エージェントには任せない)

1. (決定済み 2026-09-03)PR #690 の 4 件: 権限モデルは 30 に統一、回答 URL は参照型、二者承認は 1 人運用で本人再確認に代替、25 を参照する 5 機能に 1 行追記。
2. tags のテナント分離方針(単一組織か多テナントか)。決まるまでコードは書かない。
3. Lステップ検証用アカウントの契約(月 2,980 円〜)。未確認前提 10 件のうち影響「高」3 件を実機で潰す。
4. 本番 Cron Trigger の実設定確認(Cloudflare ダッシュボード)。
5. Pencil の主ボタン文字色(白 on #06c755 は約 2.3:1 で AA 不合格)をどうするか。設計の根幹なので人が決める。
