# 機能監査418件の対応状況

> 正本: [機能監査 #617](https://github.com/kentavndng/line-harness-board/issues/617)、[Phase 0 #618](https://github.com/kentavndng/line-harness-board/issues/618)、修正Issue #619〜#660、統合・検証窓口 [#264](https://github.com/kentavndng/line-harness-board/issues/264)、各PR。
> 観測時点: 2026-09-09 13:10 JST。Pencil・V6の見た目比較・`/restaurant-test` は対象外。
> `unmapped` は「Issue/PRとの明示対応を一次資料から証明できない」という意味です。未修正・未起票とは断定しません。

旧デザイン点検610件の台帳は[移行直前の履歴](https://github.com/skmtmst/line-harness-oss/blob/534136f9722fc4ba3e32e7af063e0ed5ecd4839d/docs/audit-status.md)と[作成PR #1386](https://github.com/skmtmst/line-harness-oss/pull/1386)に残し、この418件へは混ぜません。

一次資料は `/tmp/lh-v6-functional-audit/consolidated.md`、同ディレクトリの `phase0-final-comment.md` と `phase0-m1/m2/m4/m5/m6/m7/m8.md`、#617、#618、#264、#619〜#660、観測時点のopen/merged PRです。各行の `consolidated`、`feature-XX.md`、`phase0-mX` はこの一時資料ディレクトリ内を指します。

## 機械検証済み集計

| 区分 | 件数 |
| --- | ---: |
| 重大 | 42 |
| 中 | 232 |
| 軽 | 144 |
| **合計** | **418** |

410件は `consolidated.md` §2の一意なN-IDです。Phase 0でE-01/E-02/E-03/E-05/E-06/E-08/E-09/E-10の8件を確定追加し、N-061を中から軽へ移した結果、42/232/144になります。E-04/E-07は未確認のため418件に含めません。

| 追跡状態 | 件数 | 意味 |
| --- | ---: | --- |
| 本流統合・検証反映済み | 27 | codex/developmentへの統合と検証環境反映を確認 |
| 未統合の票・PR | 66 | Issue/PRとの一意な対応あり。審査・差し戻し・依存待ちを含む |
| unmapped | 325 | 明示対応を一次資料から証明できない |
| **合計** | **418** | |

本流統合済み27件は、列車213・検証環境52回目まで反映を確認しています。残りは391件です。個別行の状態・列車・staging欄はGitHub Issue/PRと照合しながら更新中で、上の集計を現在値の正本とします。N-065のPR #1444は列車外で直接統合され、独立再審査の残件を#654/PR #1476で追補中です。

#629〜#635は監査後の横断改善ですが、418件のN/E-IDを付与されていないため、根拠なく個別行へ結び付けていません。#660/PR #1478は、N-366の安全設定を実build生成物で配備するための関連対応としてN-366行へ併記しています。

## 全418件

### 機能01 ダッシュボード

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-002 | 中 | 01 ダッシュボード | 写真審査件数が選択アカウントで絞られない | unmapped | — | — | — | — | consolidated §2 F01-M-2／feature-01.md／page.tsx:600,682／lib/api.ts:7416／nen-members.ts:641-657／同上／高／#617 |
| N-003 | 中 | 01 ダッシュボード | 今月の配信が選んだ期間で集計される | unmapped | — | — | — | — | consolidated §2 F01-M-3／feature-01.md／packages/db/src/dashboard.ts:642-663,685／page.tsx:696-698／同上／高／#617 |
| N-004 | 中 | 01 ダッシュボード | 写真審査への深掘りが効かず既定タブに着く | unmapped | — | — | — | — | consolidated §2 F01-M-4／feature-01.md／page.tsx:682／nen-members/page.tsx（URL読取なし）／同上／高／#617 |
| N-006 | 中 | 01 ダッシュボード | 保存ボタン連打が自操作に409競合を出す | unmapped | — | — | — | — | consolidated §2 F01-M-6／feature-01.md／dashboard-editor.tsx:338-341／page.tsx:433-455／コード読み／中（実機連打未実施）／#617 |
| N-007 | 中 | 01 ダッシュボード | 基準時刻が生成時刻で鮮度・stale表示がない | unmapped | — | — | — | — | consolidated §2 F01-M-7／feature-01.md／packages/db/src/dashboard.ts:666-677／worker/routes/dashboard.ts:188,265／web40+worker19 PASS／コード／高／#617 |
| N-008 | 軽 | 01 ダッシュボード | 禁止文言「取得できません」「読み込み中」が残る | unmapped | — | — | — | — | consolidated §2 F01-L-1／feature-01.md／page.tsx:253,659,671,675,708,712／pending-inbox-card.tsx:156／shipment-panel.tsx:69,95／同上／高／#617 |
| N-009 | 軽 | 01 ダッシュボード | すべての通知を見る→がパネル内100件読込だけ | unmapped | — | — | — | — | consolidated §2 F01-L-2／feature-01.md／page.tsx:780-782／notification-panel.tsx:83／同上／高／#617 |
| N-010 | 軽 | 01 ダッシュボード | 期間・編集中・QRがURLに残らず再読込で消える | unmapped | — | — | — | — | consolidated §2 F01-L-3／feature-01.md／page.tsx:364-371／api.ts:8108-8123／notification-center.ts:42／同上／高／#617 |
| N-011 | 軽 | 01 ダッシュボード | 経路一覧がテナント全体で選択アカウントと無関係 | unmapped | — | — | — | — | consolidated §2 F01-L-4／feature-01.md／entry-routes.ts:100-108／page.tsx:135-145／qr-dialog.tsx:96-110／同上／高／#617 |
| N-012 | 軽 | 01 ダッシュボード | 二段階認証が組織全体の値と書いていない | unmapped | — | — | — | — | consolidated §2 F01-L-5／feature-01.md／page.tsx:336-343／同上／高／#617 |
| N-013 | 軽 | 01 ダッシュボード | 経路不明が経路名として出る・内訳なしが経路なし | unmapped | — | — | — | — | consolidated §2 F01-L-6／feature-01.md／packages/db/src/dashboard.ts:597-602／friend-trend-table.tsx:100-110／同上／高／#617 |
| N-014 | 軽 | 01 ダッシュボード | 編集パネル・QR窓にEscape閉じがない | unmapped | — | — | — | — | consolidated §2 F01-L-7／feature-01.md／dashboard-editor.tsx:280-282／qr-dialog.tsx:186-198／コード／高（実機キー未確認）／#617 |
| N-015 | 軽 | 01 ダッシュボード | 受信明細リンクの余分な指定は相手側で無視される | unmapped | — | — | — | — | consolidated §2 F01-L-9／feature-01.md／pending-inbox-card.tsx:39-44／chats/page.tsx:865-881／同上／高／#617 |

### 機能02 受信箱

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-016 | 中 | 02 受信箱 | 担当・未読・期限の絞り込みが手元200件にしか効かない | unmapped | — | — | — | — | consolidated §2 M1／feature-02.md／page.tsx:522-536,1602-1704／support-email-query.ts:13-26／worker40+web93+db10 PASS＋probe4件／高／#617 |
| N-017 | 中 | 02 受信箱 | メール本文検索がサーバで効かない | unmapped | — | — | — | — | consolidated §2 M2／feature-02.md／support-inbox.ts:203-207／page.tsx:1487,1604-1610／コード／高／#617 |
| N-018 | 中 | 02 受信箱 | 一覧に空状態の表示がない | unmapped | — | — | — | — | consolidated §2 M3／feature-02.md／page.tsx:1548-1836／コード／高／#617 |
| N-019 | 中 | 02 受信箱 | 並び順が新しい順1択の死に操作 | unmapped | — | — | — | — | consolidated §2 M4／feature-02.md／page.tsx:1527／コード／高／#617 |
| N-020 | 中 | 02 受信箱 | 保存する条件の一部が固定値で保存されない | unmapped | — | — | — | — | consolidated §2 M5／feature-02.md／page.tsx:694-710／コード／高／#617 |
| N-021 | 中 | 02 受信箱 | 保存した検索がURLに残らず再読込・共有で失われる | unmapped | — | — | — | — | consolidated §2 M6／feature-02.md／page.tsx:756-770,868-881／コード／高／#617 |
| N-022 | 中 | 02 受信箱 | 画像+本文の同時送信が非原子 | unmapped | — | — | — | — | consolidated §2 M7／feature-02.md／page.tsx:1004-1088／コード／高／#617 |
| N-023 | 中 | 02 受信箱 | 送信の失敗台帳がない | unmapped | — | — | — | — | consolidated §2 M8／feature-02.md／167_outbound_send_idempotency.sql:7／chats.ts:1454／outbound-idempotency.ts:28-90／コード／高／#617 |
| N-024 | 中 | 02 受信箱 | LINE取消への追従がない | unmapped | — | — | — | — | consolidated §2 M9／feature-02.md／webhook.ts・line-webhook-events.ts・page.tsx grep0／192:116／probe／高／#617 |
| N-025 | 中 | 02 受信箱 | 引用返信・送信予約がない | unmapped | — | — | — | — | consolidated §2 M10／feature-02.md／page.tsx:2145-2368 grep0／コード／高／#617 |
| N-026 | 中 | 02 受信箱 | テンプレ変数が解決されず未解決のまま送れる | unmapped | — | — | — | — | consolidated §2 M11／feature-02.md／template-picker.tsx:313,284-293／page.tsx:2358-2365／chats.ts:1306-1414／コード／中（記法正本未確認）／#617 |
| N-027 | 軽 | 02 受信箱 | 保存失敗の競合・権限エラー文言が汎用化（競合時のみ） | unmapped | — | — | — | — | consolidated §2 L1／feature-02.md／saved-view-dialog.tsx:100-107／page.tsx:735-751／api.ts:1939-1950／コード／高／#617 |
| N-028 | 軽 | 02 受信箱 | 新規DMの送信失敗が無言 | unmapped | — | — | — | — | consolidated §2 L2／feature-02.md／page.tsx:231-256／コード／高／#617 |
| N-029 | 軽 | 02 受信箱 | 送信上限超過の特定文言が出ない | unmapped | — | — | — | — | consolidated §2 L3／feature-02.md／chats.ts:1377-1378／page.tsx:1091-1096／コード／高／#617 |
| N-030 | 軽 | 02 受信箱 | 一覧の読込失敗に再試行ボタンがない | unmapped | — | — | — | — | consolidated §2 L4／feature-02.md／page.tsx:1275-1279（対照1571-1582）／コード／高／#617 |
| N-031 | 軽 | 02 受信箱 | メモpopover等にフォーカストラップがない | unmapped | — | — | — | — | consolidated §2 L5／feature-02.md／inbox-dropdown.tsx等／コード／中／#617 |

### 機能03 友だち

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-032 | 中 | 03 友だち | 集計4口が明示アカウント指定の権限確認をしていない | unmapped | — | — | — | — | consolidated §2 M1／feature-03.md／worker/routes/friends.ts:819-941（対照一覧:367・保存検索:174）／Worker83+Web36+連携136+DB6 PASS／コード／高／#617 |
| N-033 | 中 | 03 友だち | 詳細の受信箱で開くが友だちを引き継がない | unmapped | — | — | — | — | consolidated §2 M2／feature-03.md／detail/page.tsx:318,381,406,423,431,553／chats/page.tsx:871／mock再現／高／#617 |
| N-034 | 中 | 03 友だち | 保存した検索の変更・削除口がない | unmapped | — | — | — | — | consolidated §2 C1／feature-03.md／friends.ts:217-295（GET/POSTのみ）／コード／高／#617 |
| N-035 | 中 | 03 友だち | 友だち本体の表示・担当・対応状態を変える口が友だち側にない | unmapped | — | — | — | — | consolidated §2 C2／feature-03.md／友だち側はタグ・metadata・属性・メッセージのみ／コード／高／#617 |
| N-036 | 中 | 03 友だち | 詳細の流入元がいつも不明と出る | unmapped | — | — | — | — | consolidated §2 C3／feature-03.md／detail/page.tsx:489-491／shared/types.ts:35-39／コード／高／#617 |
| N-037 | 中 | 03 友だち | 一般staffは属性保存で403なのに画面は編集できる | unmapped | — | — | — | — | consolidated §2 C4／feature-03.md／friend-fields.ts:755／コード／高（実トークン未実施）／#617 |
| N-038 | 軽 | 03 友だち | 一覧に流入元列がない | unmapped | — | — | — | — | consolidated §2 L1／feature-03.md／一覧APIは返すが行は描かない／コード／高／#617 |
| N-039 | 軽 | 03 友だち | 保存検索・通知ダイアログにEsc・フォーカス復元がない | unmapped | — | — | — | — | consolidated §2 L2／feature-03.md／ダイアログ実装／コード／高／#617 |
| N-040 | 軽 | 03 友だち | 注目切替（metadata PUT）に改訂番号・冪等キーがない | unmapped | — | — | — | — | consolidated §2 L3／feature-03.md／metadata PUT経路／コード／中／#617 |
| N-041 | 軽 | 03 友だち | タグ付け→シナリオ登録でタグ・シナリオと友だちのアカウント一致を見ない | unmapped | — | — | — | — | consolidated §2 L4／feature-03.md／friends.ts:1009-1035／scenario-triggers.ts:42-56／tags.ts:527-542／コード／中（配信側未確認）／#617 |

### 機能04 友だち属性

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-042 | 中 | 04 友だち属性 | 友だち情報欄の値保存に型検証がなく何でも文字列保存される | 修正中（差し戻し） | [#656](https://github.com/kentavndng/line-harness-board/issues/656) | [#1477](https://github.com/skmtmst/line-harness-oss/pull/1477) | — | 未反映 | consolidated §2 重大-1／feature-04.md／worker/routes/friend-fields.ts:784,827／packages/db/src/friend-fields.ts:563,142／Worker150+Web142 PASS／コード／高／#617 |
| N-043 | 重大 | 04 友だち属性 | 一括値更新にアカウント境界検査がなく他アカウントにも書き込める | 本流統合 | [#624](https://github.com/kentavndng/line-harness-board/issues/624) | [#1440](https://github.com/skmtmst/line-harness-oss/pull/1440) | 203/[#1451](https://github.com/skmtmst/line-harness-oss/pull/1451) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 重大-2／feature-04.md／worker/routes/friend-fields.ts:800-836（対照単票:759）／コード／高／#617 |
| N-044 | 中 | 04 友だち属性 | 手動タグ付与で手動禁止とタグのアカウント所属を検査しない | unmapped | — | — | — | — | consolidated §2 中-1／feature-04.md／worker/routes/friends.ts:1009-1040／コード／高／#617 |
| N-045 | 中 | 04 友だち属性 | 個人情報の閲覧・編集がowner/admin固定で個別権限が効かない | unmapped | — | — | — | — | consolidated §2 中-2／feature-04.md／friend-fields.ts:713,759／コード／高／#617 |
| N-046 | 中 | 04 友だち属性 | 一括値更新が逐次書きで途中失敗すると半反映、冪等キーなし | unmapped | — | — | — | — | consolidated §2 中-3／feature-04.md／friend-fields.ts:800-836／コード／高／#617 |
| N-047 | 中 | 04 友だち属性 | マイル遡及にサーバ側の事前計算がない | unmapped | — | — | — | — | consolidated §2 中-4／feature-04.md／packages/db/src/tags.ts:1072／コード／高／#617 |
| N-048 | 中 | 04 友だち属性 | 旧経路のタグ作成・CSV一括登録がアカウント範囲なしの行を作る | unmapped | — | — | — | — | consolidated §2 中-5／feature-04.md／worker/routes/tags.ts:927-953／packages/db/src/tags.ts:766-812／コード／高／#617 |
| N-049 | 軽 | 04 友だち属性 | ドラッグ並び替えにキーボード操作がない | unmapped | — | — | — | — | consolidated §2 中-6→軽／feature-04.md／tags-page-v4.tsx／field-list.tsx／mark-list.tsx／saved-search-list.tsx（onKeyDown 0件）／コード／高／#617 |

### 機能05 シナリオ配信

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-050 | 重大 | 05 シナリオ配信 | 公開版がなく稼働中の編集が進行中へ直反映する | PR審査 | [#644](https://github.com/kentavndng/line-harness-board/issues/644) | [#1468](https://github.com/skmtmst/line-harness-oss/pull/1468) | 列車待ち | 未反映 | consolidated §2 F05-S-01／feature-05.md／schema.sql:102-111／step-delivery.ts:374-376,445-446／307 migration:5／scenarios.ts:1037／Web181+Worker160+DB26 PASS／コード／高／#617 |
| N-051 | 中 | 05 シナリオ配信 | staff個別権限が下書き保存以外で効かない | unmapped | — | — | — | — | consolidated §2 F05-M-01／feature-05.md／scenarios.ts:50-67,1283 vs 507,565,666,678,808,1025,1037,1314,1493,1770,1733／コード／高／#617 |
| N-052 | 中 | 05 シナリオ配信 | テンプレート参照が生参照で進行中へ反映する | unmapped | — | — | — | — | consolidated §2 F05-M-02／feature-05.md／scenario-resolve.ts:39-66／step-delivery.ts:445-446／immediate-first-step.ts:292／コード＋テスト／高／#617 |
| N-053 | 中 | 05 シナリオ配信 | アクション参照先の存在・所属を検証しない | unmapped | — | — | — | — | consolidated §2 F05-M-03／feature-05.md／scenarios.ts:1422-1472／scenario-actions.ts／コード＋テスト23件／高／#617 |
| N-054 | 中 | 05 シナリオ配信 | 友だち単位の停止・再開・移動・失敗再送の口と画面がない | unmapped | — | — | — | — | consolidated §2 F05-M-04／feature-05.md／scenarios.ts口一覧（enroll:1314・test-send:1733のみ）／実行テスト160件に該当なし／高／#617 |
| N-055 | 軽 | 05 シナリオ配信 | 作る押下で空行が作られ中断するとゴミ行が残る | unmapped | — | — | — | — | consolidated §2 F05-L-01／feature-05.md／scenarios/page.tsx:257-278／コード／高／#617 |
| N-057 | 軽 | 05 シナリオ配信 | テスト送信に送信先単位の連打防止がなく重複実送信する | unmapped | — | — | — | — | consolidated §2 F05-L-03／feature-05.md／scenario-test-send.ts／scenarios.ts:1733-1742／rate-limit.ts／コード／中／#617 |
| N-058 | 軽 | 05 シナリオ配信 | 詳細の通一覧が横幅1040px固定で狭画面は横スクロール | unmapped | — | — | — | — | consolidated §2 F05-L-04／feature-05.md／scenario-detail-client.tsx:1822／コード／中（実機未確認）／#617 |

### 機能06 一斉配信

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-059 | 重大 | 06 一斉配信 | 送信開始後に止める・直す・失敗だけ送り直す口がない | unmapped | — | — | — | — | consolidated §2 重大1／feature-06.md／worker/routes/broadcasts.ts:1018,1220／packages/db/src/broadcasts.ts:5,546／305 migration／Worker80+DB4+Web40 PASS／コード／高／#617 |
| N-060 | 重大 | 06 一斉配信 | タグ配信の対象人数プレビューが他アカウント分も数える | 本流統合 | [#625](https://github.com/kentavndng/line-harness-board/issues/625) | [#1441](https://github.com/skmtmst/line-harness-oss/pull/1441) | 202/[#1449](https://github.com/skmtmst/line-harness-oss/pull/1449) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 重大2／feature-06.md／broadcasts.ts:535-540 vs tags.ts:1203-1209／broadcast.ts:297／mock-tag-preview.cjs実測{"previewCount":8,"actualSend_accA":3}／高／#617 |
| N-061 | 軽 | 06 一斉配信 | staffは個別権限があっても作成〜送信のすべてが403 | unmapped | — | — | — | — | consolidated §2 中3／feature-06.md／broadcasts.ts登録一覧／role-guard.ts:15／コード／高／#617 |
| N-062 | 中 | 06 一斉配信 | 送信時に送信枠と送信後アクション公開状態を再確認しない | unmapped | — | — | — | — | consolidated §2 中4／feature-06.md／broadcasts.ts:1275-1709（fetchQuota・validateAfterActionVersionなし）／コード／中（実LINE未実施）／#617 |
| N-063 | 軽 | 06 一斉配信 | メッセージ種別の切替がキーボード矢印操作に対応していない | unmapped | — | — | — | — | consolidated §2 軽1／feature-06.md／broadcast-form.tsx:1363-1374／コード／中（実機キー未実施）／#617 |

### 機能07 リマインダ

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-064 | 中 | 07 リマインダ | 登録ごとの基準日変更・個別取消/再開・登録者一覧が画面からできない | unmapped | — | — | — | — | consolidated §2 F07-S-01／feature-07.md／reminders/detail/page.tsx／reminder-publish-flow.tsx／reminders.ts:996-1049／packages/db/src/reminders.ts:795／Worker71+Web43+Shared28+Scope34 PASS／高／#617 |
| N-065 | 重大 | 07 リマインダ | 予約の取消・日程変更がV6リマインダ登録へ伝わらない | PR審査（追補） | [#623](https://github.com/kentavndng/line-harness-board/issues/623) / [#654](https://github.com/kentavndng/line-harness-board/issues/654) | [#1444](https://github.com/skmtmst/line-harness-oss/pull/1444) / [#1476](https://github.com/skmtmst/line-harness-oss/pull/1476) | 列車外で#1444直入／追補待ち | 未反映 | consolidated §2 F07-S-02／feature-07.md／booking.ts:2621-2624／reminder-trigger.ts／reminders.ts:795-798／reminder-delivery.ts:167-186／コード／高／#617 |
| N-066 | 中 | 07 リマインダ | 2通目以降の通知を画面から作る・直す・消せない | unmapped | — | — | — | — | consolidated §2 F07-S-03／feature-07.md／issue469-reminder-screens.tsx:65-74,88-90／reminder-v6-ui.tsx:100-102／new/page.tsx:58-64／コード／高／#617 |
| N-067 | 中 | 07 リマインダ | 手動登録にサーバ側の二重防止がなく重複送信しうる | unmapped | — | — | — | — | consolidated §2 F07-M-01／feature-07.md／packages/db/src/reminders.ts:749-787／274 migration:62／reminders.ts:704-706,1064-1066／コード／中（行複製確定、送信二重は追跡）／#617 |
| N-068 | 中 | 07 リマインダ | うるう年以外は3/1固定で2/28・送らないを選べない | unmapped | — | — | — | — | consolidated §2 F07-M-02／feature-07.md／shared/anniversary.ts:30-44／anniversary.test.ts:51-56／コード＋テスト／高／#617 |
| N-069 | 中 | 07 リマインダ | staffは許可友だちの登録・取消ができず現場が止まる | unmapped | — | — | — | — | consolidated §2 F07-M-03／feature-07.md／reminders.ts:554,638,701,738,849,880,910,996,1041,1052／コード／高／#617 |
| N-070 | 中 | 07 リマインダ | テスト送信先の設定口が画面になく失敗時も直し方が分からない | unmapped | — | — | — | — | consolidated §2 F07-M-04／feature-07.md／reminder-draft.ts:170-172／reminder-publish-flow.tsx:84-93,147／コード／高／#617 |
| N-071 | 中 | 07 リマインダ | 配信予定プレビューに固定の見せかけ数字が混ざる | unmapped | — | — | — | — | consolidated §2 F07-M-05／feature-07.md／reminder-publish-flow.tsx:131-137／reminders.ts:671-699／コード／高／#617 |
| N-072 | 中 | 07 リマインダ | 一覧の基準日・並び順・表示件数が飾り | unmapped | — | — | — | — | consolidated §2 F07-M-06／feature-07.md／reminders/page.tsx:59-63,174-175／コード／高／#617 |
| N-073 | 中 | 07 リマインダ | 新版を公開しても既存登録は古い版のまま | unmapped | — | — | — | — | consolidated §2 F07-M-07／feature-07.md／packages/db/src/reminders.ts:497-583／コード／高／#617 |
| N-074 | 中 | 07 リマインダ | 友だち情報欄・イベント起点を画面から完成できない | unmapped | — | — | — | — | consolidated §2 F07-M-08／feature-07.md／new/page.tsx:52-71／reminder-publish-flow.tsx:119-129／reminder-draft.ts:98-101／コード／高／#617 |
| N-075 | 中 | 07 リマインダ | 画面が約束するSlack通知にサーバ側の裏付けがない | unmapped | — | — | — | — | consolidated §2 F07-M-09／feature-07.md／reminder-publish-flow.tsx:133-134,159-164／grep／中（汎用経路の可能性あり）／#617 |
| N-076 | 軽 | 07 リマインダ | 要件ルートと実装ルートが違い直リンクがずれる | unmapped | — | — | — | — | consolidated §2 F07-L-01／feature-07.md／app/reminders/（4ファイルのみ）／コード／高／#617 |
| N-077 | 軽 | 07 リマインダ | 検索欄は名前・内容と書くが通の内容は探さない | unmapped | — | — | — | — | consolidated §2 F07-L-02／feature-07.md／page.tsx:174／reminders.ts:443-447／コード／高／#617 |
| N-078 | 軽 | 07 リマインダ | リマインダ名の上限が画面60文字だけで裏側にない | unmapped | — | — | — | — | consolidated §2 F07-L-03／feature-07.md／new/page.tsx:90／reminders.ts:218-220／コード／高／#617 |
| N-079 | 軽 | 07 リマインダ | 押せないボタン・変わらない表示が残っている | unmapped | — | — | — | — | consolidated §2 F07-L-04／feature-07.md／reminder-publish-flow.tsx:164／detail/page.tsx:391／new/page.tsx:98-100／コード／高／#617 |
| N-080 | 軽 | 07 リマインダ | 入力途中の戻る・再読込で未保存が消える | unmapped | — | — | — | — | consolidated §2 F07-L-05／feature-07.md／new/page.tsx:28-36,52-71／コード／中／#617 |

### 機能08 自動応答

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | 軽 | 08 自動応答 | 専用の停止口がなく、停止理由・停止者・停止日時が残らない | unmapped | — | — | — | — | phase0-m1 E-01／自動応答の登録12口、停止迂回PUT、DB列、Worker30件・Web82件PASS／#618 |
| E-02 | 軽 | 08 自動応答 | 編集ダイアログがEscで閉じず、共通のフォーカス制御も使わない | unmapped | — | — | — | — | phase0-m1 E-02／edit-dialog.tsxと共通Dialogの比較、Web82件PASS／#618 |
| N-081 | 中 | 08 自動応答 | 失敗した後続処理の再実行口が無い | unmapped | — | — | — | — | consolidated §2 重大1／feature-08.md／auto-reply-runs.ts全文／auto-replies.tsルート登録／serializeRun canRetry:false／Worker102+DB15+Web82 PASS／コード／高／#617 |
| N-082 | 重大 | 08 自動応答 | 画像・スタンプ等の非テキスト受信は自動応答に届かない | 本流統合 | [#619](https://github.com/kentavndng/line-harness-board/issues/619) | [#1442](https://github.com/skmtmst/line-harness-oss/pull/1442) | 202/[#1449](https://github.com/skmtmst/line-harness-oss/pull/1449) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 重大2／feature-08.md／worker/routes/webhook.ts非テキスト早期return／MESSAGE_KINDS対比／コード／高（実機最終要確認）／#617 |
| N-083 | 中 | 08 自動応答 | テスト時の評価順が本番とずれる場合がある | unmapped | — | — | — | — | consolidated §2 中1／feature-08.md／auto-reply.ts:493-500／auto-replies.ts:669-688／compareAutoReplyCandidates／コード／高／#617 |
| N-084 | 中 | 08 自動応答 | staffは公開前テストを実行できない | unmapped | — | — | — | — | consolidated §2 中2／feature-08.md／auto-replies.ts:1038,1096,1132,1143,1158,1245／mid.test.ts staff403 PASS／高／#617 |
| N-085 | 中 | 08 自動応答 | 削除が物理削除 | unmapped | — | — | — | — | consolidated §2 中3／feature-08.md／packages/db/src/auto-replies.ts:303付近／schema.sql FKなし／コード／高／#617 |
| N-086 | 軽 | 08 自動応答 | 一覧の行に停止ボタンが無い | unmapped | — | — | — | — | consolidated §2 軽2／feature-08.md／auto-replies/page.tsx操作セル／コード／高／#617 |
| N-087 | 軽 | 08 自動応答 | 一覧検索が部分一致のみ・大文字小文字を区別する | unmapped | — | — | — | — | consolidated §2 軽4／feature-08.md／page.tsx絞り込み実装／コード／高／#617 |
| N-088 | 軽 | 08 自動応答 | どんなときに動くか列が先頭語のみ・条件チップが時間系中心 | unmapped | — | — | — | — | consolidated §2 軽5／feature-08.md／conditionChips・ruleSubtitle／コード／高／#617 |

### 機能09 友だち追加時配信

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-101 | 重大 | 09 友だち追加時配信 | 曜日・時間帯・友だち条件・再送制限が本番配信で効いていない | PR審査 | [#622](https://github.com/kentavndng/line-harness-board/issues/622) | [#1445](https://github.com/skmtmst/line-harness-oss/pull/1445) | 列車待ち | 未反映 | consolidated §2 F09-S-01／feature-09.md／apps/worker/src/services/friend-add-routing.ts:341-384／現実行150件PASS＋コード読み／確度高／#617 |
| N-102 | 中 | 09 友だち追加時配信 | アクション実行の履歴が記録されず失敗の再試行口もない | unmapped | — | — | — | — | consolidated §2 F09-M-01／feature-09.md／apps/worker/src/services/friend-add-routing.ts:211-273／現実行150件PASS＋INSERT横断検索／確度高／#617 |
| N-103 | 中 | 09 友だち追加時配信 | 実行結果の詳細を見る画面がない | unmapped | — | — | — | — | consolidated §2 F09-M-02／feature-09.md／apps/worker/src/routes/friend-add-rules.ts:476-550／現実行150件PASS＋ls確認／確度高／#617 |
| N-104 | 中 | 09 友だち追加時配信 | 受け皿を代替なしで停止でき旧「全部流す」に戻り得る | unmapped | — | — | — | — | consolidated §2 F09-M-03／feature-09.md／packages/db/src/friend-add-rules.ts:454-487／現実行150件PASS＋コード読み／確度高／#617 |
| N-105 | 中 | 09 友だち追加時配信 | 手順バーのボタン移動では保存されず未保存入力が消える | unmapped | — | — | — | — | consolidated §2 F09-M-04／feature-09.md／apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:241-247／現実行150件PASS＋コード読み／確度高／#617 |
| N-106 | 中 | 09 友だち追加時配信 | staffにも顧客名・メッセージ全文が見える | unmapped | — | — | — | — | consolidated §2 F09-M-05／feature-09.md／apps/worker/src/routes/friend-add-rules.ts:595-680／現実行150件PASS＋コード読み／確度中／#617 |
| N-107 | 軽 | 09 友だち追加時配信 | 反応しない「その他操作」ボタン | unmapped | — | — | — | — | consolidated §2 F09-L-01／feature-09.md／apps/web/src/app/friend-add-settings/page.tsx:275／現実行150件PASS＋コード読み／確度高／#617 |
| N-108 | 軽 | 09 友だち追加時配信 | テスト確認面の固定表示「Kenta Kawano」「待機時間を10秒へ短縮」 | unmapped | — | — | — | — | consolidated §2 F09-L-02／feature-09.md／apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:370／現実行150件PASS＋コード読み／確度高／#617 |
| N-109 | 軽 | 09 友だち追加時配信 | サマリーの「二重送信」表示が実はテスト実施状態 | unmapped | — | — | — | — | consolidated §2 F09-L-03／feature-09.md／apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:376／現実行150件PASS＋コード読み／確度高／#617 |
| N-110 | 軽 | 09 友だち追加時配信 | 要件書の個別ルート直打ちが404になる | unmapped | — | — | — | — | consolidated §2 F09-L-04／feature-09.md／apps/web/src/app/friend-add-settings/配下ls確認／現実行150件PASS＋ls確認／確度高／#617 |
| N-111 | 軽 | 09 友だち追加時配信 | CSV書き出しは表示中の20件だけ | unmapped | — | — | — | — | consolidated §2 F09-L-05／feature-09.md／apps/web/src/app/friend-add-settings/runs/page.tsx:216-239／現実行150件PASS＋コード読み／確度高／#617 |
| N-112 | 軽 | 09 友だち追加時配信 | 「社内メモ」と「使う友だち条件」が同じ欄の二重表示 | unmapped | — | — | — | — | consolidated §2 F09-L-06／feature-09.md／apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:293,336／現実行150件PASS＋コード読み／確度高／#617 |

### 機能10 ウェビナー

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-113 | 重大 | 10 ウェビナー | 申込フォームを選ぶ画面がなく公開必須項目を満たせない | 本流統合 | [#620](https://github.com/kentavndng/line-harness-board/issues/620) | [#1443](https://github.com/skmtmst/line-harness-oss/pull/1443) | 202/[#1449](https://github.com/skmtmst/line-harness-oss/pull/1449) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F10-S-01／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:1432-1433／現実行223件PASS＋tsx横断検索／確度高／#617 |
| N-114 | 中 | 10 ウェビナー | CTAが旧単体方式とカード方式で二重管理され利用者が迷う | unmapped | — | — | — | — | consolidated §2 F10-M-01／feature-10.md／apps/web/src/components/webinars/webinar-form.tsx:56-59／現実行223件PASS＋コード読み／確度高／#617 |
| N-115 | 中 | 10 ウェビナー | 動画がR2プレフィックス手入力のみで連携がない | unmapped | — | — | — | — | consolidated §2 F10-M-02／feature-10.md／apps/web/src/components/webinars/webinar-form.tsx:208-211／現実行223件PASS＋コード読み／確度高／#617 |
| N-116 | 中 | 10 ウェビナー | 視聴後アクションの参照先が自由入力で存在検査がない | unmapped | — | — | — | — | consolidated §2 F10-M-03／feature-10.md／apps/worker/src/routes/webinars.ts:940-962／現実行223件PASS＋コード読み／確度高／#617 |
| N-117 | 中 | 10 ウェビナー | 公開前検査の取得失敗に再試行がなく公開ボタンが固まる | 本流統合・検証反映済み | [#674](https://github.com/kentavndng/line-harness-board/issues/674) | [#1499](https://github.com/skmtmst/line-harness-oss/pull/1499) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F10-M-04／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:1476-1480／現実行223件PASS＋コード読み／確度高／#617 |
| N-118 | 中 | 10 ウェビナー | 個人視聴履歴に役割の絞りがなくstaffも全員分見える | unmapped | — | — | — | — | consolidated §2 F10-M-05／feature-10.md／apps/worker/src/routes/webinars.ts:1825-1857／現実行223件PASS＋コード読み／確度高／#617 |
| N-119 | 中 | 10 ウェビナー | CTAなしでは公開できないのに画面に書いていない | unmapped | — | — | — | — | consolidated §2 F10-M-06／feature-10.md／apps/worker/src/routes/webinars.ts:1239-1246／コード読み／確度中（意図要確認）／#617 |
| N-120 | 中 | 10 ウェビナー | CTA段のフォーム候補の取得失敗が沈黙する | 本流統合・検証反映済み | [#674](https://github.com/kentavndng/line-harness-board/issues/674) | [#1499](https://github.com/skmtmst/line-harness-oss/pull/1499) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F10-M-07／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:1057-1068／現実行223件PASS＋コード読み／確度高／#617 |
| N-124 | 軽 | 10 ウェビナー | 検索で1文字打つたびに一覧が読込表示に消える | unmapped | — | — | — | — | consolidated §2 F10-L-04／feature-10.md／apps/web/src/app/webinars/page.tsx:162-208／現実行223件PASS＋コード読み／確度高／#617 |
| N-125 | 軽 | 10 ウェビナー | 参加者管理の「稼働状況」が実状態と無関係の固定表示 | 本流統合・検証反映済み | [#674](https://github.com/kentavndng/line-harness-board/issues/674) | [#1499](https://github.com/skmtmst/line-harness-oss/pull/1499) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F10-L-05／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:431-432／現実行223件PASS＋コード読み／確度高／#617 |
| N-126 | 軽 | 10 ウェビナー | 分析のタブ風表示が押せない | 本流統合・検証反映済み | [#674](https://github.com/kentavndng/line-harness-board/issues/674) | [#1499](https://github.com/skmtmst/line-harness-oss/pull/1499) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F10-L-06／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:445／現実行223件PASS＋コード読み／確度高／#617 |
| N-127 | 軽 | 10 ウェビナー | 視聴秒0の人を「視聴エラー」と表示する | 本流統合・検証反映済み | [#674](https://github.com/kentavndng/line-harness-board/issues/674) | [#1499](https://github.com/skmtmst/line-harness-oss/pull/1499) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F10-L-07／feature-10.md／apps/web/src/app/webinars/edit/page.tsx:416／現実行223件PASS＋コード読み／確度高／#617 |
| N-129 | 軽 | 10 ウェビナー | アーカイブ対話に「公開中は先に停止」の事前案内がない | unmapped | — | — | — | — | consolidated §2 F10-L-09／feature-10.md／apps/web/src/app/webinars/page.tsx:502-515／現実行223件PASS＋コード読み／確度高／#617 |
| N-130 | 軽 | 10 ウェビナー | 動画の長さ0秒をサーバーが許す | unmapped | — | — | — | — | consolidated §2 F10-L-10／feature-10.md／apps/worker/src/routes/webinars.ts:979-983／現実行223件PASS＋コード読み／確度高／#617 |

### 機能11 テンプレート

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-131 | 重大 | 11 テンプレート | 直したつもりが本番の送信文まで変わる | PR審査 | [#645](https://github.com/kentavndng/line-harness-board/issues/645) | [#1470](https://github.com/skmtmst/line-harness-oss/pull/1470) | 列車待ち | 未反映 | consolidated §2 F11-S-01／feature-11.md／packages/db/src/templates.ts:98-150／現実行Worker35＋DB798＋Web84＋配信73件PASS／確度高／#617 |
| N-132 | 中 | 11 テンプレート | 検索欄が本文・差し込み項目では探せない | unmapped | — | — | — | — | consolidated §2 F11-M-01／feature-11.md／apps/web/src/app/templates/page.tsx:251-255／現実行84件PASS＋コード読み／確度高／#617 |
| N-134 | 中 | 11 テンプレート | URL欄に作り物の例が本物の状態として出る | unmapped | — | — | — | — | consolidated §2 F11-M-03／feature-11.md／apps/web/src/app/templates/edit/page.tsx:281-296／現実行84件PASS＋コード読み／確度高／#617 |
| N-135 | 中 | 11 テンプレート | 使用中の差し替え導線が1件目しか開けない | unmapped | — | — | — | — | consolidated §2 F11-M-04／feature-11.md／apps/web/src/app/templates/page.tsx:1141-1176／現実行84件PASS＋コード読み／確度高／#617 |
| N-136 | 中 | 11 テンプレート | 一斉配信・個別トークの選択画面が別アカウントの文まで読む | unmapped | — | — | — | — | consolidated §2 F11-M-05／feature-11.md／apps/web/src/components/broadcasts/broadcast-form.tsx:616-617／現実行84件PASS＋コード読み／確度高／#617 |
| N-137 | 中 | 11 テンプレート | 存在しない・別所属のテンプレート参照が作れる | unmapped | — | — | — | — | consolidated §2 F11-M-06／feature-11.md／apps/worker/src/routes/scenarios.ts:1004付近／現実行35件PASS＋コード読み／確度高／#617 |
| N-138 | 中 | 11 テンプレート | 差し込める項目が要件の半分 | unmapped | — | — | — | — | consolidated §2 F11-M-07／feature-11.md／apps/web/src/app/templates/edit/page.tsx:217-246／現実行84件PASS＋コード読み／確度高／#617 |
| N-139 | 中 | 11 テンプレート | 壊れたカード型JSONでも保存できる | unmapped | — | — | — | — | consolidated §2 F11-M-08／feature-11.md／apps/worker/src/routes/templates.ts:330-347／現実行35件PASS＋コード読み／確度高／#617 |
| N-140 | 軽 | 11 テンプレート | 一覧の行がキーボードだけで開けない | unmapped | — | — | — | — | consolidated §2 F11-L-01／feature-11.md／apps/web/src/app/templates/page.tsx:812-817／現実行84件PASS＋コード読み／確度高／#617 |
| N-141 | 軽 | 11 テンプレート | 「フォルダ」と「置き場」の二重入力 | unmapped | — | — | — | — | consolidated §2 F11-L-02／feature-11.md／apps/web/src/app/templates/edit/page.tsx:181-198／コード読み／確度中／#617 |
| N-142 | 軽 | 11 テンプレート | 質問テンプレの使用数が「シナリオN通」と出る | unmapped | — | — | — | — | consolidated §2 F11-L-03／feature-11.md／apps/web/src/app/templates/questions/new/page.tsx:107,264／現実行84件PASS＋コード読み／確度高／#617 |
| N-143 | 軽 | 11 テンプレート | 詳細画面の使用先リンクが一覧止まり | unmapped | — | — | — | — | consolidated §2 F11-L-04／feature-11.md／apps/web/src/app/templates/detail/page.tsx:121-158／現実行84件PASS＋コード読み／確度高／#617 |
| N-144 | 軽 | 11 テンプレート | 一般スタッフにも作る・消す口が有効に見える | unmapped | — | — | — | — | consolidated §2 F11-L-05／feature-11.md／apps/web/src/app/templates/list-state-kind.ts:92-100／現実行35件PASS＋コード読み／確度高／#617 |
| N-145 | 軽 | 11 テンプレート | 画像URLの形式検査なし | unmapped | — | — | — | — | consolidated §2 F11-L-06／feature-11.md／apps/worker/src/routes/templates.ts:309-366／現実行35件PASS＋コード読み／確度高／#617 |
| N-146 | 軽 | 11 テンプレート | 口を直接叩くと空の名前・空の本文で更新できる | unmapped | — | — | — | — | consolidated §2 F11-L-07／feature-11.md／apps/worker/src/routes/templates.ts:368-446／現実行35件PASS＋コード読み／確度高／#617 |
| N-147 | 軽 | 11 テンプレート | フォルダは全アカウント共有だが案内が曖昧 | unmapped | — | — | — | — | consolidated §2 F11-L-08／feature-11.md／packages/db/src/folders.ts:55-84／コード読み／確度中／#617 |
| N-148 | 軽 | 11 テンプレート | メッセージ編集の見本が{{name}}しか置き換えない | unmapped | — | — | — | — | consolidated §2 F11-L-09／feature-11.md／apps/web/src/app/templates/edit/page.tsx:106／配信系73件PASS＋コード読み／確度高／#617 |
| N-149 | 軽 | 11 テンプレート | カルーセル新規の2段階保存で後半失敗時の戻り方が出ない | unmapped | — | — | — | — | consolidated §2 F11-L-10／feature-11.md／apps/web/src/app/templates/carousel/page.tsx:257-283／コード読み／確度中／#617 |

### 機能12 リッチメニュー

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-08 | 重大 | 12 リッチメニュー | 公開予約を保存しても、時刻到来時に実行する処理が存在しない | PR審査 | [#621](https://github.com/kentavndng/line-harness-board/issues/621) | [#1446](https://github.com/skmtmst/line-harness-oss/pull/1446) | 列車待ち | 未反映 | phase0-m6 E-08／保存口・cron全仕事・queue・script全数照合、関連テストPASS／#502・#618 |
| N-150 | 中 | 12 リッチメニュー | 公開に冪等キーがなく二重公開になる | unmapped | — | — | — | — | consolidated §2 F12-S-01／feature-12.md／apps/worker/src/routes/rich-menu-groups.ts:1560-1572／現実行229件PASS＋コード読み／確度高／#617 |
| N-151 | 中 | 12 リッチメニュー | 公開版・実行台帳・再試行・照合修復の操作口がない | unmapped | — | — | — | — | consolidated §2 F12-S-02／feature-12.md／Worker内validate/retry/reconcile/runs検索0件／現実行229件PASS＋横断検索／確度高／#617 |
| N-152 | 中 | 12 リッチメニュー | 自分のLINEで確かめる手段がない | unmapped | — | — | — | — | consolidated §2 F12-S-03／feature-12.md／apps/web/src/app/rich-menus/edit/page.tsx:505-512／現実行229件PASS＋コード読み／確度高／#617 |
| N-154 | 中 | 12 リッチメニュー | 日時選択・コピーのボタン動作がない | unmapped | — | — | — | — | consolidated §2 F12-M-01／feature-12.md／packages/shared/src/rich-menu.ts:4-11／現実行229件PASS＋コード読み／確度高／#617 |
| N-155 | 中 | 12 リッチメニュー | 読み上げラベルが必須・20字制限になっていない | unmapped | — | — | — | — | consolidated §2 F12-M-02／feature-12.md／apps/web/src/app/rich-menus/area-properties.tsx:187-190／現実行229件PASS＋コード読み／確度高／#617 |
| N-156 | 中 | 12 リッチメニュー | 店員が人数確認・影響確認を使えない | unmapped | — | — | — | — | consolidated §2 F12-M-03／feature-12.md／apps/worker/src/routes/rich-menu-groups.ts:951,992／現実行229件PASS＋コード読み／確度中／#617 |
| N-157 | 中 | 12 リッチメニュー | 予約のやり直しが重複予約になる | unmapped | — | — | — | — | consolidated §2 F12-M-04／feature-12.md／apps/web/src/app/rich-menus/edit/page.tsx:670-680／現実行229件PASS＋コード読み／確度高／#617 |
| N-158 | 中 | 12 リッチメニュー | 公開中の定義を直接上書きする | unmapped | — | — | — | — | consolidated §2 F12-M-05／feature-12.md／apps/web/src/app/rich-menus/edit/page.tsx:441-477／現実行229件PASS＋コード読み／確度高／#617 |
| N-159 | 中 | 12 リッチメニュー | 到達不能・戻れないまま公開できる | unmapped | — | — | — | — | consolidated §2 F12-M-06／feature-12.md／apps/worker/src/services/rich-menu-publisher.ts:200-280／現実行229件PASS＋コード読み／確度高／#617 |
| N-160 | 中 | 12 リッチメニュー | 一覧の要点（KPI）が隠れて見えない | unmapped | — | — | — | — | consolidated §2 F12-M-07／feature-12.md／apps/web/src/app/rich-menus/page.tsx:537-542／現実行229件PASS＋コード読み／確度中／#617 |
| N-161 | 中 | 12 リッチメニュー | 新規作成で切替・付随設定が完結しない | unmapped | — | — | — | — | consolidated §2 F12-M-08／feature-12.md／apps/web/src/app/rich-menus/new/page.tsx:31／現実行229件PASS＋コード読み／確度中／#617 |
| N-162 | 軽 | 12 リッチメニュー | 未保存で戻る/再読込すると入力が消える | unmapped | — | — | — | — | consolidated §2 F12-L-01／feature-12.md／rich-menus配下beforeunload検索0件／現実行229件PASS＋検索／確度中／#617 |
| N-163 | 軽 | 12 リッチメニュー | 検索が名前・ボタン文言のみ | unmapped | — | — | — | — | consolidated §2 F12-L-02／feature-12.md／apps/web/src/app/rich-menus/page.tsx:488-489／現実行229件PASS＋コード読み／確度低／#617 |
| N-164 | 軽 | 12 リッチメニュー | 画像選択が素リンクで選択値が引き継がれない | unmapped | — | — | — | — | consolidated §2 F12-L-03／feature-12.md／apps/web/src/app/rich-menus/new/page.tsx:438／現実行229件PASS＋コード読み／確度低／#617 |

### 機能13 フォーム

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-165 | 重大 | 13 フォーム | 送信に冪等キーがなく再送で二重回答・二重特典になる | PR審査 | [#646](https://github.com/kentavndng/line-harness-board/issues/646) | [#1469](https://github.com/skmtmst/line-harness-oss/pull/1469) | 列車待ち | 未反映 | consolidated §2 F13-S-01／feature-13.md／apps/worker/src/routes/forms.ts:1017-1156／現実行124件PASS＋grep／確度高／#617 |
| N-166 | 重大 | 13 フォーム | 公開版がなく公開中の編集が顧客画面へ即時反映される | unmapped | — | — | — | — | consolidated §2 F13-S-02／feature-13.md／apps/worker/src/routes/forms.ts:509-573／現実行124件PASS＋grep／確度高／#617 |
| N-167 | 重大 | 13 フォーム | 全体上限・選択肢定員が同時回答で超え得る | unmapped | — | — | — | — | consolidated §2 F13-S-03／feature-13.md／apps/worker/src/services/form-layout-effects.ts:58-95／現実行124件PASS＋コード読み／確度高／#617 |
| N-168 | 中 | 13 フォーム | 回答後アクションの失敗が見えず再実行できない | unmapped | — | — | — | — | consolidated §2 F13-S-04／feature-13.md／apps/worker/src/services/form-layout-effects.ts:226-232／現実行124件PASS＋grep／確度高／#617 |
| N-169 | 中 | 13 フォーム | 編集の同時編集ガードがなく後勝ちで上書きされる | unmapped | — | — | — | — | consolidated §2 F13-S-05／feature-13.md／apps/worker/src/routes/forms.ts:509-573／現実行124件PASS＋コード読み／確度高／#617 |
| N-170 | 中 | 13 フォーム | staffが個別権限で動けない（役割固定） | unmapped | — | — | — | — | consolidated §2 F13-M-01／feature-13.md／apps/worker/src/routes/forms.ts:368,424,484／現実行124件PASS＋コード読み／確度高／#617 |
| N-171 | 中 | 13 フォーム | 回答の検索・集計が表示中のページ内だけに効く | unmapped | — | — | — | — | consolidated §2 F13-M-02／feature-13.md／apps/web/src/app/form-submissions/responses/page.tsx:163-170／現実行124件PASS＋コード読み／確度高／#617 |
| N-172 | 中 | 13 フォーム | 一覧の並び順・表示件数が固定 | unmapped | — | — | — | — | consolidated §2 F13-M-03／feature-13.md／apps/web/src/app/form-submissions/page.tsx:227,287-293／現実行124件PASS＋コード読み／確度高／#617 |
| N-173 | 中 | 13 フォーム | 「集まった回答を見る」が先頭フォーム固定で誤誘導する | unmapped | — | — | — | — | consolidated §2 F13-M-04／feature-13.md／apps/web/src/app/form-submissions/page.tsx:253-259／現実行124件PASS＋コード読み／確度高／#617 |
| N-174 | 中 | 13 フォーム | 公開前確認のタブ・検査UIがない | unmapped | — | — | — | — | consolidated §2 F13-M-05／feature-13.md／apps/web/src/app/form-submissions/edit/page.tsx:128-132／現実行124件PASS＋コード読み／確度高／#617 |
| N-175 | 中 | 13 フォーム | フォルダの絞り込み・権限が未接続 | unmapped | — | — | — | — | consolidated §2 F13-M-06／feature-13.md／apps/web/src/app/form-submissions/page.tsx:263-274／現実行124件PASS＋コード読み／確度高／#617 |
| N-176 | 中 | 13 フォーム | コンバージョンへの直接連携がない | unmapped | — | — | — | — | consolidated §2 F13-M-07／feature-13.md／packages/db/src/conversion-definitions.ts:13-26／コード読み／確度中／#617 |
| N-177 | 中 | 13 フォーム | テンプレート送信がテキストのみでFlexが黙って送られない | unmapped | — | — | — | — | consolidated §2 F13-M-08／feature-13.md／apps/worker/src/services/form-layout-effects.ts:384-395／現実行124件PASS＋コード読み／確度高／#617 |
| N-178 | 中 | 13 フォーム | 旧形式フォームは期限・1人1回・定員が効かない | unmapped | — | — | — | — | consolidated §2 F13-M-09／feature-13.md／apps/worker/src/routes/forms.ts:1075-1094／現実行124件PASS＋コード読み／確度高／#617 |
| N-179 | 中 | 13 フォーム | CSV書き出しが検索条件を引き継がない | unmapped | — | — | — | — | consolidated §2 F13-M-10／feature-13.md／apps/web/src/app/form-submissions/responses/page.tsx:185-222／現実行124件PASS＋コード読み／確度高／#617 |
| N-180 | 軽 | 13 フォーム | 一覧の「更新」列が作成日を表示している | unmapped | — | — | — | — | consolidated §2 F13-L-01／feature-13.md／apps/web/src/app/form-submissions/page.tsx:396／現実行124件PASS＋コード読み／確度高／#617 |
| N-181 | 軽 | 13 フォーム | 初回空状態に実装事情の文言が混ざる | unmapped | — | — | — | — | consolidated §2 F13-L-02／feature-13.md／apps/web/src/app/form-submissions/page.tsx:339／現実行124件PASS＋コード読み／確度高／#617 |
| N-182 | 軽 | 13 フォーム | 非ページ分け回答APIが500件で打ち切る | unmapped | — | — | — | — | consolidated §2 F13-L-04／feature-13.md／apps/worker/src/routes/forms.ts:721-735／現実行124件PASS＋コード読み／確度高／#617 |

### 機能14 共通情報

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-183 | 重大 | 14 共通情報 | 数値の加算・減算が非原子的で同時実行に弱い | 本流統合 | [#636](https://github.com/kentavndng/line-harness-board/issues/636) | [#1458](https://github.com/skmtmst/line-harness-oss/pull/1458) | 207/[#1475](https://github.com/skmtmst/line-harness-oss/pull/1475) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F14-S-1／feature-14.md／apps/worker/src/services/scenario-actions.ts:550-580／現実行196件PASS＋コード読み／確度高／#617 |
| N-184 | 重大 | 14 共通情報 | 複数アカウント重複排除配信でアカウント別に解決されない | 本流統合 | [#640](https://github.com/kentavndng/line-harness-board/issues/640) | [#1461](https://github.com/skmtmst/line-harness-oss/pull/1461) | 206/[#1467](https://github.com/skmtmst/line-harness-oss/pull/1467) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F14-S-2／feature-14.md／apps/worker/src/services/dedup-broadcast.ts:388-399／現実行196件PASS＋コード読み／確度高／#617 |
| N-185 | 中 | 14 共通情報 | 影響確認を飛ばした保存をサーバー側で止められない | unmapped | — | — | — | — | consolidated §2 F14-M-1／feature-14.md／apps/worker/src/routes/contents.ts:1472-1543／現実行196件PASS＋コード読み／確度高／#617 |
| N-186 | 中 | 14 共通情報 | 使用先走査が9種のみで他機能の差し込みが見えない | unmapped | — | — | — | — | consolidated §2 F14-M-2／feature-14.md／packages/db/src/common-vars.ts:90-270／コード読み／確度中／#617 |
| N-187 | 中 | 14 共通情報 | 長文・年月日・日時・真偽がなく値は200文字まで | unmapped | — | — | — | — | consolidated §2 F14-M-3／feature-14.md／packages/db/src/common-vars.ts:11／現実行196件PASS＋コード読み／確度高／#617 |
| N-188 | 中 | 14 共通情報 | 有効期限・代替値・期限切れ動作がない | unmapped | — | — | — | — | consolidated §2 F14-M-4／feature-14.md／packages/db/src/common-vars.ts:15-37／現実行196件PASS＋コード読み／確度高／#617 |
| N-189 | 中 | 14 共通情報 | 未知・削除済みキーが空文字で黙って送られる | unmapped | — | — | — | — | consolidated §2 F14-M-5／feature-14.md／apps/worker/src/services/render-message.ts:72-77／現実行196件PASS＋コード読み／確度高／#617 |
| N-190 | 軽 | 14 共通情報 | 新規作成画面で社内メモを書けない | unmapped | — | — | — | — | consolidated §2 F14-L-1／feature-14.md／apps/web/src/app/contents/vars/new/page.tsx:101-144／現実行196件PASS＋コード読み／確度高／#617 |
| N-191 | 軽 | 14 共通情報 | 秘密値の保存抑止・注意書きがない | unmapped | — | — | — | — | consolidated §2 F14-L-2／feature-14.md／vars3画面に秘密文言なし／現実行196件PASS＋コード読み／確度高／#617 |
| N-192 | 軽 | 14 共通情報 | 監査用CSV出力がない | unmapped | — | — | — | — | consolidated §2 F14-L-3／feature-14.md／apps/worker/src/routes/contents.tsにexportsなし／現実行196件PASS＋grep／確度高／#617 |

### 機能15 メディア

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-193 | 中 | 15 メディア | 他機能からメディア庫を選べない | unmapped | — | — | — | — | consolidated §2 F15-S-1／feature-15.md／apps/web/src全体でMediaItem参照はcontentsのみ／現実行274件PASS＋grep／確度高／#617 |
| N-194 | 中 | 15 メディア | 使用先が保存時に記録されず削除判断が古い走査頼み | unmapped | — | — | — | — | consolidated §2 F15-S-2／feature-15.md／apps/worker/src/services/media-usage-scan.ts:95,204／現実行274件PASS＋コード読み／確度高／#617 |
| N-195 | 重大 | 15 メディア | ダウンロードが権限・監査なしの直リンク | 本流統合 | [#637](https://github.com/kentavndng/line-harness-board/issues/637) | [#1459](https://github.com/skmtmst/line-harness-oss/pull/1459) | 206/[#1467](https://github.com/skmtmst/line-harness-oss/pull/1467) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F15-S-3／feature-15.md／apps/web/src/app/contents/page.tsx:848-856／現実行274件PASS＋コード読み／確度高／#617 |
| N-196 | 中 | 15 メディア | 詳細がURL化されておらず戻る・再読込・共有ができない | unmapped | — | — | — | — | consolidated §2 F15-M-1／feature-15.md／apps/web/src/app/contents/page.tsx:472-490／現実行274件PASS＋コード読み／確度高／#617 |
| N-197 | 中 | 15 メディア | staffに編集・削除ボタンが見えるのにAPIはowner/admin限定 | unmapped | — | — | — | — | consolidated §2 F15-M-2／feature-15.md／apps/worker/src/routes/contents.ts:678,724,751／現実行274件PASS＋コード読み／確度高／#617 |
| N-198 | 中 | 15 メディア | 「上限に近い」絞り込みが容量逼迫と無関係 | unmapped | — | — | — | — | consolidated §2 F15-M-3／feature-15.md／packages/db/src/media.ts:108-111／現実行274件PASS＋コード読み／確度高／#617 |
| N-199 | 中 | 15 メディア | 差し替え互換性が種類一致だけで寸法等を見ない | unmapped | — | — | — | — | consolidated §2 F15-M-4／feature-15.md／apps/worker/src/routes/contents.ts:249-282／現実行274件PASS＋コード読み／確度高／#617 |
| N-200 | 中 | 15 メディア | ウェビナー使用時は一括差し替えが全体停止する | unmapped | — | — | — | — | consolidated §2 F15-M-5／feature-15.md／packages/db/src/media.ts:450-457／現実行274件PASS＋コード読み／確度中／#617 |
| N-201 | 中 | 15 メディア | アーカイブ・監査の仕事ができない | unmapped | — | — | — | — | consolidated §2 F15-M-6／feature-15.md／contents.tsにarchive経路なし／現実行274件PASS＋grep／確度高／#617 |
| N-202 | 中 | 15 メディア | 版の固定参照・ライブ参照の切り替えがない | unmapped | — | — | — | — | consolidated §2 F15-M-7／feature-15.md／apps/worker/src/routes/contents.ts:507-598／現実行274件PASS＋コード読み／確度高／#617 |
| N-204 | 軽 | 15 メディア | 容量80%の案内が一覧で変わらない | unmapped | — | — | — | — | consolidated §2 F15-L-2／feature-15.md／apps/web/src/app/contents/page.tsx:517／コード読み／確度中／#617 |
| N-205 | 軽 | 15 メディア | 差し替え候補に検索がなく大量データで探せない | unmapped | — | — | — | — | consolidated §2 F15-L-3／feature-15.md／apps/web/src/app/contents/media-replacement-dialog.tsx:44-58／コード読み／確度中／#617 |

### 機能16 成果・アフィリエイト

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-206 | 重大 | 16 成果・アフィリエイト | 承認済み報酬が版固定されず後編集で支払額が変わる | PR審査 | [#647](https://github.com/kentavndng/line-harness-board/issues/647) | [#1473](https://github.com/skmtmst/line-harness-oss/pull/1473) | 列車待ち | 未反映 | consolidated §2 F16-S-1／feature-16.md／packages/db/src/affiliate-settlements.ts:36-43／現実行268件PASS＋grep／確度高／#617 |
| N-207 | 中 | 16 成果・アフィリエイト | 成果承認の作業面が各状態200件で止まる | unmapped | — | — | — | — | consolidated §2 F16-M-1／feature-16.md／apps/web/src/app/affiliates/tabs.tsx:1582-1586／現実行268件PASS＋コード読み／確度高／#617 |
| N-208 | 中 | 16 成果・アフィリエイト | 同時承認・同時却下が後勝ちで無警告に上書きされる | unmapped | — | — | — | — | consolidated §2 F16-M-2／feature-16.md／apps/worker/src/routes/conversions.ts:957-1030／現実行268件PASS＋コード読み／確度高／#617 |
| N-209 | 中 | 16 成果・アフィリエイト | 一般スタッフが成果承認を実行できない | unmapped | — | — | — | — | consolidated §2 F16-M-3／feature-16.md／apps/worker/src/routes/conversions.ts:957／現実行268件PASS＋コード読み／確度高／#617 |
| N-210 | 中 | 16 成果・アフィリエイト | 紹介者登録の友だち結びつけが先頭20件からしか選べない | unmapped | — | — | — | — | consolidated §2 F16-M-4／feature-16.md／apps/web/src/app/affiliates/new/page.tsx:81-97／現実行268件PASS＋コード読み／確度高／#617 |
| N-211 | 中 | 16 成果・アフィリエイト | 案件のタグ・シナリオが他アカウント混在のまま選べる | unmapped | — | — | — | — | consolidated §2 F16-M-5／feature-16.md／apps/web/src/app/affiliate-offers/new/page.tsx:280-301／現実行268件PASS＋コード読み／確度高／#617 |
| N-212 | 中 | 16 成果・アフィリエイト | 案件のタグ・シナリオが承認時に何も実行されない | unmapped | — | — | — | — | consolidated §2 F16-M-6／feature-16.md／apps/worker/src/routes/conversions.ts:987-1023／現実行268件PASS＋grep／確度高／#617 |
| N-213 | 中 | 16 成果・アフィリエイト | まとめ承認に確認がなく部分失敗の特定ができない | unmapped | — | — | — | — | consolidated §2 F16-M-7／feature-16.md／apps/web/src/app/affiliates/tabs.tsx:1677-1709／現実行268件PASS＋コード読み／確度高／#617 |
| N-214 | 軽 | 16 成果・アフィリエイト | 案件編集モーダルが口のエラーを捨てて固定文言にする | unmapped | — | — | — | — | consolidated §2 F16-L-1／feature-16.md／apps/web/src/app/affiliates/tabs.tsx:1355-1390／現実行268件PASS＋コード読み／確度高／#617 |
| N-215 | 軽 | 16 成果・アフィリエイト | 案件の小数報酬が画面を通って英語400になる | unmapped | — | — | — | — | consolidated §2 F16-L-2／feature-16.md／apps/web/src/app/affiliate-offers/new/page.tsx:85-90／現実行268件PASS＋コード読み／確度高／#617 |
| N-216 | 軽 | 16 成果・アフィリエイト | 紹介者登録が二段階保存で中途状態が残る | unmapped | — | — | — | — | consolidated §2 F16-L-3／feature-16.md／apps/web/src/app/affiliates/new/page.tsx:147-181／現実行268件PASS＋コード読み／確度高／#617 |
| N-217 | 軽 | 16 成果・アフィリエイト | 割合報酬で0%を画面が弾く | unmapped | — | — | — | — | consolidated §2 F16-L-4／feature-16.md／apps/web/src/app/affiliates/new/page.tsx:119-124／現実行268件PASS＋コード読み／確度高／#617 |
| N-218 | 軽 | 16 成果・アフィリエイト | 成果承認キューにアカウント絞りがない | unmapped | — | — | — | — | consolidated §2 F16-L-5／feature-16.md／apps/web/src/app/affiliates/tabs.tsx:1564／現実行268件PASS＋コード読み／確度高／#617 |
| N-219 | 軽 | 16 成果・アフィリエイト | 報酬0円の承認済み成果が締めから黙って外れる | unmapped | — | — | — | — | consolidated §2 F16-L-6／feature-16.md／packages/db/src/affiliate-payouts.ts:215-216／現実行268件PASS＋コード読み／確度高／#617 |

### 機能17 マイレージ／行動スコア

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-231 | 重大 | 17 マイレージ／行動スコア | 決めごとの下書きを直しても実際の付与が変わらない（公開口なし） | unmapped | — | — | — | — | consolidated §2 F17-S-01／feature-17.md／決めごと下書き変更→以後イベント付与確認。apps/web/src/app/mileage/page.tsx:287-299、apps/worker/src/routes/scoring.ts:525-553、packages/db/src/mileage.ts:1048・1296／160件PASS（Web81・Worker64・DB15）／コード読み／確度高／#617 |
| N-232 | 重大 | 17 マイレージ／行動スコア | 履歴のある決めごとをAPI直打ちで物理削除できる | 本流統合 | [#627](https://github.com/kentavndng/line-harness-board/issues/627) | [#1448](https://github.com/skmtmst/line-harness-oss/pull/1448) | 203/[#1451](https://github.com/skmtmst/line-harness-oss/pull/1451) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F17-S-02／feature-17.md／履歴ありIDへDELETE /api/mileage/rules/:id。apps/worker/src/routes/scoring.ts:1001-1018、packages/db/src/mileage.ts:1155-1157／160件PASS／コード読み／確度高／#617 |
| N-233 | 重大 | 17 マイレージ／行動スコア | 交換失敗を管理画面から再実行・追跡する導線がない | PR審査 | [#641](https://github.com/kentavndng/line-harness-board/issues/641) | [#1464](https://github.com/skmtmst/line-harness-oss/pull/1464) | 列車待ち | 未反映 | consolidated §2 F17-S-03／feature-17.md／交換失敗後に/mileage各タブで再実行を試みる。apps/worker/src/routes/scoring.ts:388-481、apps/web/src/app/mileage/mileage-rewards-tab.tsx:253-265／160件PASS／コード読み／確度高／#617 |
| N-234 | 中 | 17 マイレージ／行動スコア | 旧スコアCRUDの参照系に認可がない | unmapped | — | — | — | — | consolidated §2 F17-M-01／feature-17.md／要否ログイン問わずGET /api/scoring-rules。apps/worker/src/routes/scoring.ts:1065-1098／160件PASS／コード読み／確度高／#617 |
| N-235 | 中 | 17 マイレージ／行動スコア | 行動スコアの手動調整・層プレビューの口がない | unmapped | — | — | — | — | consolidated §2 F17-M-03／feature-17.md／調整・preview口の不在確認。apps/worker/src/routes/action-score-rules.ts全体、apps/web/src/lib/api.ts:7935-7990／160件PASS／コード読み／確度高／#617 |
| N-236 | 中 | 17 マイレージ／行動スコア | 使い道を止めた後に一覧から戻せない | unmapped | — | — | — | — | consolidated §2 F17-M-04／feature-17.md／公開中→止める→一覧で戻そうとする。apps/web/src/app/mileage/mileage-rewards-tab.tsx:256／160件PASS／コード読み／確度中（一覧に限定）／#617 |
| N-237 | 中 | 17 マイレージ／行動スコア | CSVがこの頁のブラウザ生成で監査・権限の記録に残らない | unmapped | — | — | — | — | consolidated §2 F17-M-05／feature-17.md／各タブで頁内CSV出力。apps/web/src/app/mileage/page.tsx:391-410他／160件PASS／コード読み／確度高／#617 |
| N-238 | 中 | 17 マイレージ／行動スコア | 決めごとのきっかけが8種だけで紹介・継続等を選べない | unmapped | — | — | — | — | consolidated §2 F17-M-06／feature-17.md／/mileage/earning-rules/newの選択肢確認。apps/web/src/app/mileage/earning-rules/new/page.tsx:43-123／160件PASS／コード読み／確度高／#617 |
| N-239 | 中 | 17 マイレージ／行動スコア | スコアのルールのきっかけが7種だけで紹介等を選べない | unmapped | — | — | — | — | consolidated §2 F17-M-07／feature-17.md／/mileage/score-rulesの選択肢確認。apps/web/src/app/mileage/score-rules/page.tsx:30-38／160件PASS／コード読み／確度高／#617 |
| N-240 | 中 | 17 マイレージ／行動スコア | 決めごと作成の二段階保存に冪等鍵がなく戻る・再読込で重複し得る | unmapped | — | — | — | — | consolidated §2 F17-M-08／feature-17.md／保存押下後に戻る・再読込・再送。apps/web/src/lib/api.ts:7910-7940／160件PASS／コード読み／確度中（実機二重押下未実施）／#617 |
| N-241 | 軽 | 17 マイレージ／行動スコア | 明細の元イベント欄に台帳IDを入れている | unmapped | — | — | — | — | consolidated §2 F17-L-01／feature-17.md／/mileage/friends/detailの発生元欄追跡。apps/web/src/app/mileage/friends/detail/page.tsx:49／160件PASS／コード読み／確度高／#617 |
| N-242 | 軽 | 17 マイレージ／行動スコア | 残高検索がEnterで確定しない等タブ間で操作感がばらつく | unmapped | — | — | — | — | consolidated §2 F17-L-02／feature-17.md／残高とスコアの検索欄比較。apps/web/src/app/mileage/page.tsx:166-172他／160件PASS／コード読み／確度高（実機走査未実施）／#617 |
| N-243 | 軽 | 17 マイレージ／行動スコア | 決めごと並び順の保存が複数PATCHで部分適用し得る | unmapped | — | — | — | — | consolidated §2 F17-L-03／feature-17.md／並び順を大きく変えて競合。apps/web/src/app/mileage/page.tsx:331-355／160件PASS／コード読み／確度中／#617 |

### 機能18 流入経路

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-244 | 重大 | 18 流入経路 | 停止しても公開URLが生き続け新規受付と計測が止まらない | PR審査 | [#628](https://github.com/kentavndng/line-harness-board/issues/628) | [#1450](https://github.com/skmtmst/line-harness-oss/pull/1450) | 列車待ち | 未反映 | consolidated §2 F18-S-1／feature-18.md／経路作成→詳細で受付停止→別ブラウザで/r/{ref}。apps/worker/src/index.ts:489-560、packages/db/src/entry-routes.ts:72-80／131件PASS（Web62・Worker69）／コード読み／確度高（E2E未実行）／#617 |
| N-245 | 重大 | 18 流入経路 | 成果の広告送信に境界がなく他店へ送り重複送信し得る | PR審査 | [#638](https://github.com/kentavndng/line-harness-board/issues/638) | [#1460](https://github.com/skmtmst/line-harness-oss/pull/1460) | 列車待ち | 未反映 | consolidated §2 F18-S-2／feature-18.md／コンバージョン発生→event-bus送信先確認。apps/worker/src/services/ad-conversion.ts:16-81、packages/db/src/ad-platforms.ts:45-50／131件PASS／コード読み／確度高／#617 |
| N-246 | 中 | 18 流入経路 | 完全削除が利用中でも通り利用状況表示・ブロック・名前入力がない | unmapped | — | — | — | — | consolidated §2 F18-M-1／feature-18.md／利用中経路を詳細から完全削除。apps/worker/src/routes/entry-routes.ts:211-223、packages/db/src/entry-routes.ts:179-181／131件PASS／コード読み／確度高／#617 |
| N-247 | 中 | 18 流入経路 | 運用スタッフが流入リンクを作れない・編集できない | unmapped | — | — | — | — | consolidated §2 F18-M-2／feature-18.md／staffで作成・編集操作。apps/worker/src/routes/entry-routes.ts:127・166・211／131件PASS／コード読み／確度中（役割解釈依存）／#617 |
| N-248 | 中 | 18 流入経路 | Xへの成果送信がOAuth署名なしのまま送信パスに残っている | unmapped | — | — | — | — | consolidated §2 F18-M-3／feature-18.md／twclid持ち成果でsendXConversion追跡。apps/worker/src/services/ad-conversion.ts:126-156／131件PASS／コード読み／確度中（UI露出なし）／#617 |
| N-249 | 中 | 18 流入経路 | 広告送信用クリックID選択が最新行の各列で媒体別・期限の決めごとと違う | unmapped | — | — | — | — | consolidated §2 F18-M-4／feature-18.md／複数回来訪状態で成果発生。packages/db/src/entry-routes.ts:364-377／131件PASS／コード読み／確度中（期限値未確定のため留保）／#617 |
| N-250 | 軽 | 18 流入経路 | 削除確認ダイアログにキーボード操作の配慮がない | unmapped | — | — | — | — | consolidated §2 F18-L-2／feature-18.md／詳細で削除ダイアログを開きEsc・Tab試行。apps/web/src/app/inflow-links/detail/page.tsx:248-258／131件PASS／コード読み／確度中（静的所見）／#617 |
| N-251 | 軽 | 18 流入経路 | 金額・通貨の¥決め打ち | unmapped | — | — | — | — | consolidated §2 F18-L-3／feature-18.md／広告連携の月額・送信通貨確認。apps/web/src/app/inflow-links/ad-integration.tsx:404／131件PASS／コード読み／確度中／#617 |

### 機能19 コンバージョン

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-252 | 中 | 19 コンバージョン | 既存の成果地点を直せない（編集・新版がない） | 票あり（#652合流待ち） | [#658](https://github.com/kentavndng/line-harness-board/issues/658) | — | — | 未反映 | consolidated §2 F19-S-01／feature-19.md／一覧の中身を見るに編集なし。apps/web/src/app/conversions/page.tsx:608-633、apps/worker/src/routes/conversions.ts:372-663／198件PASS（Worker60・DB31・Web107）／コード読み／確度高／#617 |
| N-253 | 重大 | 19 コンバージョン | 選べる6起点のうち自動で数えられるのは実質1種だけ | 修正中 | [#648](https://github.com/kentavndng/line-harness-board/issues/648) | — | — | 未反映 | consolidated §2 F19-S-02／feature-19.md／6起点で地点作成→自動計数確認。apps/worker/src/routes/tracked-links.ts:449-466／198件PASS／コード読み／確度高／#617 |
| N-254 | 重大 | 19 コンバージョン | 旧更新口から版・利用先ガードを迂回して直接書き換えられる | PR審査 | [#652](https://github.com/kentavndng/line-harness-board/issues/652) | [#1481](https://github.com/skmtmst/line-harness-oss/pull/1481) | 列車待ち | 未反映 | consolidated §2 F19-S-03／feature-19.md／PUT /api/conversions/points/:idで直接更新。apps/worker/src/routes/conversions.ts:727-760／198件PASS／コード読み／確度高／#617 |
| N-255 | 重大 | 19 コンバージョン | 1人1回の同時到着で2件になる | PR審査 | [#652](https://github.com/kentavndng/line-harness-board/issues/652) | [#1481](https://github.com/skmtmst/line-harness-oss/pull/1481) | 列車待ち | 未反映 | consolidated §2 F19-S-04／feature-19.md／同一元イベント同時到着。packages/db/src/conversions.ts:257-270／198件PASS／コード読み／確度高（同時発火は要実機）／#617 |
| N-256 | 中 | 19 コンバージョン | 使う場所を足すボタンが分析画面に何も渡せない | unmapped | — | — | — | — | consolidated §2 F19-S-05／feature-19.md／一覧の行ボタン→/analytics遷移。apps/web/src/app/conversions/page.tsx:582-587／198件PASS／コード読み／確度高／#617 |
| N-257 | 中 | 19 コンバージョン | 保存前試算が入力条件の一部しか見ていない | unmapped | — | — | — | — | consolidated §2 F19-M-01／feature-19.md／作成画面で条件変更→試算比較。packages/db/src/conversion-definitions.ts:589-621／198件PASS／コード読み／確度高／#617 |
| N-258 | 中 | 19 コンバージョン | 作成時の利用先チェックが仮IDを保存する | unmapped | — | — | — | — | consolidated §2 F19-M-02／feature-19.md／/conversions/newの利用先選択。apps/web/src/app/conversions/new/page.tsx:68-72／198件PASS／コード読み／確度高／#617 |
| N-259 | 中 | 19 コンバージョン | 旧イベント一覧の終了日指定が当日分を落とす | unmapped | — | — | — | — | consolidated §2 F19-M-03／feature-19.md／旧GET eventsにendDate指定。apps/worker/src/routes/conversions.ts:850-868／198件PASS／コード読み／確度高／#617 |
| N-260 | 中 | 19 コンバージョン | 並び成果単価が高い順が期間合計順になっている | unmapped | — | — | — | — | consolidated §2 F19-M-04／feature-19.md／並びvalue-descで確認。packages/db/src/conversion-definitions.ts:234-239／198件PASS／コード読み／確度中（ラベル解釈含む）／#617 |
| N-261 | 中 | 19 コンバージョン | 種類の違う成果地点へ差し替えられる | unmapped | — | — | — | — | consolidated §2 F19-M-05／feature-19.md／replaceで異種へ付け替え。packages/db/src/conversion-definitions.ts:705-724／198件PASS／コード読み／確度高／#617 |
| N-262 | 中 | 19 コンバージョン | 成果承認がowner/adminのみで現場担当が押せない | unmapped | — | — | — | — | consolidated §2 F19-M-06／feature-19.md／PATCH events/:id/approval。apps/worker/src/routes/conversions.ts:957／198件PASS／コード読み／確度中（権限方針未定義部含む）／#617 |
| N-263 | 中 | 19 コンバージョン | 組織境界がなくLINEアカウント可視のみ | unmapped | — | — | — | — | consolidated §2 F19-M-07／feature-19.md／地点・イベントにorganization_idなし。apps/worker/src/routes/conversions.ts:893-898／198件PASS／コード読み／確度中（突破実証なし）／#617 |
| N-264 | 中 | 19 コンバージョン | 作った直後の行がどれか分からない | unmapped | — | — | — | — | consolidated §2 F19-M-08／feature-19.md／保存後highlight無視を確認。apps/web/src/app/conversions/new/page.tsx:180／198件PASS／コード読み／確度高／#617 |
| N-265 | 軽 | 19 コンバージョン | CVR・母数が常に空欄 | unmapped | — | — | — | — | consolidated §2 F19-L-02／feature-19.md／経路集計の固定null確認。packages/db/src/conversion-definitions.ts:862-927／198件PASS／コード読み／確度高／#617 |
| N-266 | 軽 | 19 コンバージョン | 日別グラフに表の代替がない | unmapped | — | — | — | — | consolidated §2 F19-L-03／feature-19.md／日別棒グラフのみ確認。apps/web/src/app/conversions/page.tsx:912-954／198件PASS／コード読み／確度中／#617 |
| N-267 | 軽 | 19 コンバージョン | 打ち切り注記が一部だけ・未使用件数がずれる可能性 | unmapped | — | — | — | — | consolidated §2 F19-L-04／feature-19.md／5000件超時の表示確認。apps/web/src/app/conversions/page.tsx:249-262／198件PASS／コード読み／確度中（大量未実測）／#617 |
| N-268 | 軽 | 19 コンバージョン | 下書き・入力不良・起点停止の状態が存在しない | unmapped | — | — | — | — | consolidated §2 F19-L-05／feature-19.md／状態がactive/stoppedのみ。packages/db/src/conversion-definitions.ts:3／198件PASS／コード読み／確度高／#617 |
| N-269 | 軽 | 19 コンバージョン | 新旧レポートの二重実装で日付・金額の扱いが違う | unmapped | — | — | — | — | consolidated §2 F19-L-06／feature-19.md／新旧report関数併存。packages/db/src/conversions.ts:397-444／198件PASS／コード読み／確度高／#617 |
| N-270 | 軽 | 19 コンバージョン | 外部Webhook・署名・受信ログが未実装 | unmapped | — | — | — | — | consolidated §2 F19-L-07／feature-19.md／public ingestの不在確認。apps/worker/src/routes/conversions.ts全体／198件PASS／コード読み／確度高（不在確認）／#617 |
| N-271 | 軽 | 19 コンバージョン | 削除確認の題名が削除しますかで固定 | unmapped | — | — | — | — | consolidated §2 F19-L-08／feature-19.md／削除不可時も題名固定。apps/web/src/app/conversions/page.tsx:635-652／198件PASS／コード読み／確度高／#617 |

### 機能20 分析

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-272 | 中 | 20 分析 | ファネル定義の編集が画面からできない | unmapped | — | — | — | — | consolidated §2 F20-S-01／feature-20.md／集計後に段・期間変更を試みる。apps/web/src/app/analytics/page.tsx:682-1128、apps/web/src/lib/api.ts:4759-4784／137件PASS（DB38・Worker60・Web39）／コード読み／確度高／#617 |
| N-273 | 中 | 20 分析 | V6ファネルの削除・停止ができない | unmapped | — | — | — | — | consolidated §2 F20-S-02／feature-20.md／一覧に削除なし・旧DELETEは404。apps/worker/src/routes/analytics.ts:932-944／137件PASS／コード読み／確度高／#617 |
| N-274 | 中 | 20 分析 | 対象者を配信作成へ直接渡せない | unmapped | — | — | — | — | consolidated §2 F20-M-01／feature-20.md／クロス・ファネルから対象者作成。apps/web/src/app/analytics/page.tsx:641・1097／137件PASS／コード読み／確度高／#617 |
| N-275 | 中 | 20 分析 | ファネル段から選べるのは止まった人だけ | unmapped | — | — | — | — | consolidated §2 F20-M-02／feature-20.md／stopped固定で対象者作成。apps/web/src/app/analytics/page.tsx:800-815／137件PASS／コード読み／確度高／#617 |
| N-276 | 中 | 20 分析 | クロス分析の軸・条件・測定・期間が画面で固定 | unmapped | — | — | — | — | consolidated §2 F20-M-03／feature-20.md／クロス集計の選択肢確認。apps/web/src/app/analytics/page.tsx:206・313／137件PASS／コード読み／確度高／#617 |
| N-277 | 中 | 20 分析 | 保存タブが定期レポートは現在なしと断定表示 | unmapped | — | — | — | — | consolidated §2 F20-M-04／feature-20.md／保存タブの固定文言確認。apps/web/src/app/analytics/page.tsx:1805・1890／137件PASS／コード読み／確度高／#617 |
| N-278 | 中 | 20 分析 | 定期レポートの一覧・停止・編集がない | unmapped | — | — | — | — | consolidated §2 F20-M-05／feature-20.md／reports配下newのみ確認。packages/db/src/analytics-reports.ts／137件PASS／コード読み／確度高／#617 |
| N-279 | 中 | 20 分析 | 使われ方の参照切れが常に仮表示 | unmapped | — | — | — | — | consolidated §2 F20-M-06／feature-20.md／brokenReferences固定partial。packages/db/src/analytics-overviews.ts:783／137件PASS／コード読み／確度高／#617 |
| N-280 | 中 | 20 分析 | リロードでクロス集計を見失い再実行が429で詰む | unmapped | — | — | — | — | consolidated §2 F20-M-07／feature-20.md／待ち中に再読込→再実行。apps/web/src/app/analytics/page.tsx:208／137件PASS／コード読み／確度高／#617 |
| N-281 | 中 | 20 分析 | 配信反応タブは200件打切りを教えない | unmapped | — | — | — | — | consolidated §2 F20-M-08／feature-20.md／一斉・シナリオ実績のLIMIT確認。packages/db/src/analytics-overviews.ts:296・309／137件PASS／コード読み／確度中（200超実在未確認）／#617 |
| N-282 | 中 | 20 分析 | ファネル参照検証が項目・フォームで他アカウントを見る | unmapped | — | — | — | — | consolidated §2 F20-M-09／feature-20.md／assertFunnelReferences確認。packages/db/src/analytics-funnels.ts:764・767／137件PASS／コード読み／確度中（悪用条件限定的）／#617 |
| N-283 | 軽 | 20 分析 | ファネル説明文が置ける段を5種と案内（実際は11種） | unmapped | — | — | — | — | consolidated §2 F20-L-01／feature-20.md／説明文と作成欄比較。apps/web/src/app/analytics/page.tsx:1118・1145-1157／137件PASS／コード読み／確度高／#617 |
| N-284 | 軽 | 20 分析 | レポートのマイルと紹介は常に未取得なのに選べる | unmapped | — | — | — | — | consolidated §2 F20-L-02／feature-20.md／reports/new選択肢と裏unavailable。apps/web/src/app/analytics/reports/new/page.tsx:23／137件PASS／コード読み／確度高／#617 |
| N-285 | 軽 | 20 分析 | 変化通知の条件は固定で調整できない | unmapped | — | — | — | — | consolidated §2 F20-L-03／feature-20.md／3ルール固定確認。apps/web/src/app/analytics/reports/new/page.tsx:122-126／137件PASS／コード読み／確度高／#617 |
| N-286 | 軽 | 20 分析 | 期間がほぼ固定（概要30日・ファネル再集計30日等） | unmapped | — | — | — | — | consolidated §2 F20-L-04／feature-20.md／rangeFor固定確認。apps/web/src/app/analytics/page.tsx:1447他／137件PASS／コード読み／確度高／#617 |
| N-287 | 軽 | 20 分析 | エラー時の再試行ボタンがレポート作成以外にない | unmapped | — | — | — | — | consolidated §2 F20-L-05／feature-20.md／各タブ失敗表示確認。apps/web/src/app/analytics/page.tsx:887-889／137件PASS／コード読み／確度高／#617 |
| N-288 | 軽 | 20 分析 | グラフ棒・期間切替の読み上げ配慮不足 | unmapped | — | — | — | — | consolidated §2 F20-L-07／feature-20.md／日別30棒titleのみ。apps/web/src/app/analytics/page.tsx:1488-1493／137件PASS／コード読み／確度中／#617 |
| N-289 | 軽 | 20 分析 | CSVは表示範囲のみの断りがURLタブ以外にない | unmapped | — | — | — | — | consolidated §2 F20-L-08／feature-20.md／書出し断り文確認。apps/web/src/app/analytics/page.tsx:1684／137件PASS／コード読み／確度高／#617 |

### 機能21 NEN配信

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-290 | 中 | 21 NEN配信 | 編集画面は4500字まで書けるのに保存は1500字で失敗する | PR審査 | [#659](https://github.com/kentavndng/line-harness-board/issues/659) | [#1479](https://github.com/skmtmst/line-harness-oss/pull/1479) | 列車待ち | 未反映 | consolidated §2 F21-S-01／feature-21.md／editで1501字以上→保存。apps/web/src/app/nen-campaigns/edit/campaign-editor.tsx:253-254、apps/worker/src/routes/nen-campaigns.ts:203／120件PASS（Worker40・Web58・連携22）／コード読み／確度高／#617 |
| N-291 | 重大 | 21 NEN配信 | 同じ人に何度も送らない等は飾り（保存も実行もされない） | unmapped | — | — | — | — | consolidated §2 F21-S-02／feature-21.md／editの2チェック→保存→送信確認。apps/web/src/app/nen-campaigns/edit/campaign-editor.tsx:242-243／120件PASS／コード読み／確度高／#617 |
| N-292 | 中 | 21 NEN配信 | ペット情報を直せない（誤りは消して作り直すしかない） | unmapped | — | — | — | — | consolidated §2 F21-M-01／feature-21.md／ペットタブに編集なし確認。apps/web/src/app/nen-campaigns/page.tsx:216-225／120件PASS／コード読み／確度高／#617 |
| N-293 | 中 | 21 NEN配信 | ペット登録が犬・性別不明・西暦必須に固定 | unmapped | — | — | — | — | consolidated §2 F21-M-02／feature-21.md／新規登録欄とWorker既定確認。apps/worker/src/routes/nen-campaigns.ts:615-617／120件PASS／コード読み／確度高／#617 |
| N-294 | 中 | 21 NEN配信 | 履歴検索は読み込んだ20件の中だけ探す | unmapped | — | — | — | — | consolidated §2 F21-M-03／feature-21.md／履歴タブで別ページ名検索。apps/web/src/app/nen-campaigns/nen-overview.tsx:549-552／120件PASS／コード読み／確度高／#617 |
| N-295 | 中 | 21 NEN配信 | 誕生日・コラムの停止口が画面にない | unmapped | — | — | — | — | consolidated §2 F21-M-04／feature-21.md／ペットタブ・フロー表に停止なし。apps/web/src/app/nen-campaigns/nen-overview.tsx:328／120件PASS／コード読み／確度高／#617 |
| N-296 | 中 | 21 NEN配信 | 流れ図の7歩のうち3歩がずっと止まっている表示＋3日目は裏に何もない | unmapped | — | — | — | — | consolidated §2 F21-M-05／feature-21.md／配信フロー図確認。apps/web/src/app/nen-campaigns/nen-overview.tsx:329-356／120件PASS／コード読み／確度高／#617 |
| N-297 | 中 | 21 NEN配信 | クーポン使われたが永遠に0（記録をどこも書かない） | unmapped | — | — | — | — | consolidated §2 F21-M-06／feature-21.md／EC利用後も指標不変。apps/worker/src/services/nen-campaign-metrics.ts:338-359／120件PASS／コード読み／確度高／#617 |
| N-298 | 中 | 21 NEN配信 | 誕生日クーポンのEC作成失敗でその回のNEN全体が止まる＋孤児クーポンの可能性 | unmapped | — | — | — | — | consolidated §2 F21-M-07／feature-21.md／cron経路追跡。apps/worker/src/index.ts:1615-1634／120件PASS／コード読み／確度高／#617 |
| N-299 | 軽 | 21 NEN配信 | 保存バーのこれから届く42通は固定文言でsnapshot方式と矛盾 | unmapped | — | — | — | — | consolidated §2 F21-L-01／feature-21.md／保存バー文言確認。apps/web/src/app/nen-campaigns/edit/campaign-editor.tsx:281／120件PASS／コード読み／確度高／#617 |
| N-300 | 軽 | 21 NEN配信 | コラム一覧は200件で黙って切れる・ペットは検索も頁送りもない | unmapped | — | — | — | — | consolidated §2 F21-L-02／feature-21.md／columns・pets一覧確認。apps/web/src/lib/api.ts:7360-7362／120件PASS／コード読み／確度高／#617 |
| N-301 | 軽 | 21 NEN配信 | 下書き消失ガードなし（コラム新規・配信編集・紹介文） | unmapped | — | — | — | — | consolidated §2 F21-L-03／feature-21.md／beforeunload不在確認。apps/web/src/app/nen-campaigns配下／120件PASS／コード読み／確度高／#617 |
| N-303 | 軽 | 21 NEN配信 | 二重押下の実害はほぼないことを確認（文言のみ紛らわしい） | unmapped | — | — | — | — | consolidated §2 F21-L-05／feature-21.md／予約・再送・まとめ送りの冪等確認。apps/worker/src/routes/nen-campaigns.ts他／120件PASS／コード読み／確度中／#617 |
| N-304 | 軽 | 21 NEN配信 | 過去日時の配信予約が予約として通る（次tickで即送られる） | unmapped | — | — | — | — | consolidated §2 F21-L-06／feature-21.md／過去日時でコラム予約。apps/worker/src/routes/nen-campaigns.ts:566-570／120件PASS／コード読み／確度高／#617 |
| N-305 | 軽 | 21 NEN配信 | パンくずの?tab=flowsは無効値（実害なし） | unmapped | — | — | — | — | consolidated §2 F21-L-07／feature-21.md／パンくず確認。apps/web/src/app/nen-campaigns/edit/campaign-editor.tsx:214／120件PASS／コード読み／確度高／#617 |

### 機能22 写真レビュー

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-306 | 重大 | 22 写真レビュー | まとめて審査した写真のLINE通知が送られない | PR審査 | [#639](https://github.com/kentavndng/line-harness-board/issues/639) | [#1465](https://github.com/skmtmst/line-harness-oss/pull/1465) | 列車待ち | 未反映 | consolidated §2 F22-S-1／feature-22.md／複数選択→まとめて確定→通知状態確認。packages/db/src/nen-photo-operations.ts、apps/worker/src/routes/nen-members.ts:1048-1072／87件PASS（Worker33・Web43・DB11）／コード読み／確度高／#617 |
| N-307 | 中 | 22 写真レビュー | ECとつながっていない採用でもポイント手続き開始と伝わる | unmapped | — | — | — | — | consolidated §2 F22-S-2／feature-22.md／customer_idなし友だちの写真を通す。apps/worker/src/routes/nen-members.ts:953-956・983-991／87件PASS／コード読み／確度高／#617 |
| N-308 | 中 | 22 写真レビュー | 探したい写真を見つけられない（一覧に検索なく200件打切り） | unmapped | — | — | — | — | consolidated §2 F22-M-1／feature-22.md／200件超で一覧を開く。apps/worker/src/routes/nen-members.ts:678-707／87件PASS／コード読み／確度高／#617 |
| N-309 | 中 | 22 写真レビュー | 傾き・トリミングの修正が保存できない。回すは見た目だけ | unmapped | — | — | — | — | consolidated §2 F22-M-2／feature-22.md／一枚表示で回す→確定→再読込。apps/web/src/app/nen-members/photo-review-detail.tsx:42-43／87件PASS／コード読み／確度高（誤解しやすさは実機未確認で中に留める）／#617 |
| N-310 | 中 | 22 写真レビュー | 投稿画像のEXIF除去・寸法検査が投稿経路にない | unmapped | — | — | — | — | consolidated §2 F22-M-3／feature-22.md／POST /api/liff/nen/photosの保存確認。apps/worker/src/routes/nen-members.ts:438-474／87件PASS／コード読み／確度中（前段除去有無未確認）／#617 |
| N-311 | 中 | 22 写真レビュー | 公開の撤回・掲載先変更が審査権限だけでできる | unmapped | — | — | — | — | consolidated §2 F22-M-4／feature-22.md／review権限で撤回・変更口を呼ぶ。apps/worker/src/routes/nen-members.ts:780・827／87件PASS／コード読み／確度中（簡略化の可能性あり）／#617 |
| N-312 | 中 | 22 写真レビュー | 差戻し画面の二つの約束が果たせない（チェックが押せない） | unmapped | — | — | — | — | consolidated §2 F22-M-5／feature-22.md／差戻しダイアログを開く。apps/web/src/app/nen-members/page.tsx:614-615／87件PASS／コード読み／確度高／#617 |
| N-313 | 軽 | 22 写真レビュー | 単体審査・通知再送に再実行キーがない（連打で他の担当者表示） | unmapped | — | — | — | — | consolidated §2 F22-L-1／feature-22.md／通すを素早く二度押し（コード読解）。apps/web/src/lib/api.ts reviewPhoto他／87件PASS／コード読み／確度中（実表示は実機未確認）／#617 |
| N-314 | 軽 | 22 写真レビュー | ブラウザの戻る・再読込で詳細位置と選択が消える | unmapped | — | — | — | — | consolidated §2 F22-L-2／feature-22.md／一枚表示で進み選択→再読込。apps/web/src/app/nen-members/page.tsx:46-70／87件PASS／コード読み／確度高（困り度で軽）／#617 |

### 機能23 EC連携

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-315 | 重大 | 23 EC連携 | EC受信がV6自動化・分析・スコアV6へ届かない（連携断） | PR審査 | [#649](https://github.com/kentavndng/line-harness-board/issues/649) | [#1472](https://github.com/skmtmst/line-harness-oss/pull/1472) | 列車待ち | 未反映 | consolidated §2 F23-S-01／feature-23.md／ec.order.confirmed受信→自動化履歴確認。apps/worker/src/routes/ec-integrations.ts:452・488-491、apps/worker/src/services/event-bus.ts:100-132／92件PASS／コード読み／確度高（結合テストなし）／#617 |
| N-316 | 重大 | 23 EC連携 | 一部参照APIにec.event.viewが付いていない（権限漏れ） | 本流統合 | [#626](https://github.com/kentavndng/line-harness-board/issues/626) | [#1447](https://github.com/skmtmst/line-harness-oss/pull/1447) | 203/[#1451](https://github.com/skmtmst/line-harness-oss/pull/1451) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264) release 48待ち） | consolidated §2 F23-S-02／feature-23.md／staffで4GET直叩き。apps/worker/src/routes/ec-commerce.ts:199・265・377・537／92件PASS／コード読み／確度高／#617 |
| N-318 | 中 | 23 EC連携 | 取り込み記録の商品明細が未取得に誤表示される（注文joinが先頭100件だけ） | unmapped | — | — | — | — | consolidated §2 F23-M-02／feature-23.md／21件以上で2ページ目以降を開く。apps/web/src/app/ec-commerce/page.tsx:105-109・135-138／92件PASS／コード読み／確度高／#617 |
| N-319 | 中 | 23 EC連携 | 未対応event種別がECの出来事に潰れる | unmapped | — | — | — | — | consolidated §2 F23-M-03／feature-23.md／4種別を取り込む。apps/web/src/app/ec-commerce/page.tsx:41-50／92件PASS／コード読み／確度高／#617 |
| N-320 | 中 | 23 EC連携 | 止めると影響の件数が全体件数と混在＋やり直し規定が常時非表示 | unmapped | — | — | — | — | consolidated §2 F23-M-04／feature-23.md／connectorタブの影響件数確認。apps/worker/src/routes/ec-commerce.ts:400・439／92件PASS／コード読み／確度高／#617 |
| N-321 | 中 | 23 EC連携 | 取り込み記録が部分失敗でKPIごと消える | unmapped | — | — | — | — | consolidated §2 F23-M-05／feature-23.md／一部API失敗状態で/ec-commerceを開く。apps/web/src/app/ec-commerce/page.tsx:105-130／92件PASS／コード読み／確度高／#617 |
| N-322 | 中 | 23 EC連携 | 取り込みを止めるが保存必須の2段階で止めたつもりになる | unmapped | — | — | — | — | consolidated §2 F23-M-06／feature-23.md／止める押下後に保存せず離脱。apps/web/src/app/ec-commerce/connector-panel.tsx:151／92件PASS／コード読み／確度高／#617 |
| N-323 | 軽 | 23 EC連携 | ふつうは1分以内が固定文言で実測SLOが見えない | unmapped | — | — | — | — | consolidated §2 F23-L-01／feature-23.md／最終受信表示確認。apps/web/src/app/ec-commerce/page.tsx:206／92件PASS／コード読み／確度高／#617 |
| N-324 | 軽 | 23 EC連携 | 取り込み記録の検索が今の20件だけに効く | unmapped | — | — | — | — | consolidated §2 F23-L-02／feature-23.md／当ページ20件へのclient絞り。apps/web/src/app/ec-commerce/page.tsx:140-152／92件PASS／コード読み／確度高／#617 |
| N-325 | 軽 | 23 EC連携 | 定期便検索のplaceholderが実検索対象とずれる | unmapped | — | — | — | — | consolidated §2 F23-L-03／feature-23.md／placeholderと対象比較。apps/web/src/app/ec-commerce/subscriptions-panel.tsx:88・57-62／92件PASS／コード読み／確度高／#617 |
| N-326 | 軽 | 23 EC連携 | 保存ボタンが押せない理由が分からない | unmapped | — | — | — | — | consolidated §2 F23-L-04／feature-23.md／新規で鍵32文字未満時。apps/web/src/app/ec-commerce/connector-panel.tsx:152／92件PASS／コード読み／確度中／#617 |

### 機能24 LINE通知

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-10 | 中 | 24 LINE通知 | 安全な再送・詳細・送信枠・顧客テスト・対応済み操作がなくretryだけしかない | unmapped | — | — | — | — | phase0-m7 E-10／LINE通知の全9口・画面・DB・要件を照合、Worker13件PASS／#509・#618 |
| N-327 | 重大 | 24 LINE通知 | 運用者通知が業務イベントから自動で飛ばない | unmapped | — | — | — | — | consolidated §2 F24-S-1／feature-24.md／ルール公開→業務イベント→記録確認。apps/worker/src/routes/notifications.ts:559／69件PASS（Worker28・Web41）／コード読み／確度高／#617 |
| N-328 | 中 | 24 LINE通知 | 顧客のEC送信が共通送信台帳に書かれない | unmapped | — | — | — | — | consolidated §2 F24-S-2／feature-24.md／EC送信後にhistory・failures確認。apps/worker/src/routes/ec-commerce.ts:532／69件PASS／コード読み／確度高／#617 |
| N-330 | 中 | 24 LINE通知 | 顧客編集の保存先が新旧2つに分かれる | unmapped | — | — | — | — | consolidated §2 F24-M-2／feature-24.md／定義有無で編集保存比較。apps/web/src/app/line-notifications/page.tsx:336／69件PASS／コード読み／確度高／#617 |
| N-332 | 中 | 24 LINE通知 | 運用者作成のきっかけが4件だけで1件は誤表示 | unmapped | — | — | — | — | consolidated §2 F24-M-4／feature-24.md／operator/newのきっかけ確認。apps/web/src/app/line-notifications/operator/new/page.tsx:15／69件PASS／コード読み／確度高／#617 |
| N-333 | 中 | 24 LINE通知 | 公開ボタンが出すのまま | unmapped | — | — | — | — | consolidated §2 F24-M-5／feature-24.md／operator/new下部バー確認。同:268／69件PASS／コード読み／確度高／#617 |
| N-335 | 中 | 24 LINE通知 | 月間送信枠の残りが通知画面のどこにも出ない | unmapped | — | — | — | — | consolidated §2 F24-M-7／feature-24.md／4タブ＋作成のKPI確認。apps/web/src/app/line-notifications/customer-kpis.ts／69件PASS／コード読み／確度高／#617 |
| N-336 | 中 | 24 LINE通知 | 失敗タブの絞り込みが足りない | unmapped | — | — | — | — | consolidated §2 F24-M-8／feature-24.md／failures絞りと要件比較。同notification-run-list.tsx:157／69件PASS／コード読み／確度高／#617 |
| N-337 | 軽 | 24 LINE通知 | 編集画面が狭い幅で横にはみ出す | unmapped | — | — | — | — | consolidated §2 F24-L-1／feature-24.md／編集レイアウト確認。apps/web/src/app/line-notifications/page.tsx:144／69件PASS／コード読み／確度高（見え方は要実機）／#617 |
| N-338 | 軽 | 24 LINE通知 | 送った数が多い順と書いてあるが並べ替えていない | unmapped | — | — | — | — | consolidated §2 F24-L-2／feature-24.md／注記とvisible比較。同:460／69件PASS／コード読み／確度高／#617 |
| N-339 | 軽 | 24 LINE通知 | 常に空の集計カードがある | unmapped | — | — | — | — | consolidated §2 F24-L-3／feature-24.md／失敗・記録タブの固定—確認。同notification-run-list.tsx:181／69件PASS／コード読み／確度高／#617 |
| N-340 | 軽 | 24 LINE通知 | 編集中に再読込すると内容が消える | unmapped | — | — | — | — | consolidated §2 F24-L-4／feature-24.md／stateのみ・beforeunloadなし確認。apps/web/src/app/line-notifications/page.tsx／69件PASS／コード読み／確度高／#617 |
| N-341 | 軽 | 24 LINE通知 | 運用者タブの件数が常に— | unmapped | — | — | — | — | consolidated §2 F24-L-5／feature-24.md／タブ見出し確認。同:330／69件PASS／コード読み／確度中／#617 |
| N-342 | 軽 | 24 LINE通知 | APIの置き場所が要件の名前と違う | unmapped | — | — | — | — | consolidated §2 F24-L-6／feature-24.md／/api/notifications使用確認。apps/web/src/app/line-notifications配下／69件PASS／コード読み／確度高／#617 |

### 機能25 オートメーション

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-351 | 中 | 25 オートメーション | staffが下書きを作れない | unmapped | — | — | — | — | consolidated §2 F25-M-1／feature-25.md／apps/worker/src/routes/automations.ts:282-290,292-305,321-351,353-369、apps/web/src/components/automations/use-can-manage.ts／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-352 | 中 | 25 オートメーション | 一覧の行操作不足（編集・複製・保管・記録導線なし） | unmapped | — | — | — | — | consolidated §2 F25-M-2／feature-25.md／apps/web/src/app/automations/page.tsx:508-511／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-353 | 中 | 25 オートメーション | 実行台帳にCSV書出しと実行取消がない | unmapped | — | — | — | — | consolidated §2 F25-M-4／feature-25.md／apps/web/src/app/automations/runs/page.tsx:140-144、apps/worker/src/routes/automations.ts:557-588／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-354 | 中 | 25 オートメーション | 記録詳細が薄い（版・処理別結果・試行回数・テスト札なし） | unmapped | — | — | — | — | consolidated §2 F25-M-5／feature-25.md／apps/web/src/app/automations/runs/page.tsx:212-239、apps/worker/src/routes/automations.ts:140-180／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-355 | 中 | 25 オートメーション | 作成画面の選択肢が狭い（きっかけ6種・処理2種のみ） | unmapped | — | — | — | — | consolidated §2 F25-M-6／feature-25.md／apps/web/src/app/automations/new/page.tsx:42-86、apps/worker/src/services/automation-drafts.ts:387-395,413-440／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-356 | 中 | 25 オートメーション | 自動化から共通アクションを呼べない | unmapped | — | — | — | — | consolidated §2 F25-M-7／feature-25.md／apps/worker/src/services/automation-drafts.ts:413-440、apps/worker/src/services/automation-engine.ts:228-290／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-357 | 中 | 25 オートメーション | 保存後に再読込すると下書きが増える | unmapped | — | — | — | — | consolidated §2 F25-M-8／feature-25.md／apps/web/src/app/automations/new/page.tsx:118,252-314／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-358 | 中 | 25 オートメーション | 1人テストに事前確認がない（実送信・ID手入力のみ） | unmapped | — | — | — | — | consolidated §2 F25-M-9／feature-25.md／apps/web/src/app/automations/new/page.tsx:316-332,568-572、apps/worker/src/services/automation-definitions.ts:255-306／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-359 | 軽 | 25 オートメーション | タグきっかけ注意書きが実物と食い違い | unmapped | — | — | — | — | consolidated §2 F25-L-1／feature-25.md／apps/web/src/app/automations/new/page.tsx:53-57,390-391／Worker80件＋Web61件PASS/コード読み/確度高／#617 |
| N-360 | 軽 | 25 オートメーション | 一覧の稼働切替に二重押しガードがない | unmapped | — | — | — | — | consolidated §2 F25-L-2／feature-25.md／apps/web/src/app/automations/page.tsx:223-242,257-279／Worker80件＋Web61件PASS/コード読み/確度高（連打実機は未検証）／#617 |
| N-361 | 軽 | 25 オートメーション | 閲覧のみ利用者にも操作ボタンが出る | unmapped | — | — | — | — | consolidated §2 F25-L-3／feature-25.md／apps/web/src/app/automations/page.tsx:508-511／Worker80件＋Web61件PASS/コード読み/確度高／#617 |

### 機能26 外部連携

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-363 | 中 | 26 外部連携 | 送り先の名前・URL・イベント・再送回数を作成後に直せない | unmapped | — | — | — | — | consolidated §2 F26-S-02／feature-26.md／apps/worker/src/routes/webhooks.ts:652、apps/web/src/app/webhooks/page.tsx:178-208,296-326／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-364 | 重大 | 26 外部連携 | シークレットが暗号化されず平文保存される | PR審査 | [#650](https://github.com/kentavndng/line-harness-board/issues/650) | [#1474](https://github.com/skmtmst/line-harness-oss/pull/1474) | 列車待ち | 未反映 | consolidated §2 F26-S-03／feature-26.md／packages/db/src/webhooks.ts:493-535、apps/worker/src/routes/webhooks.ts:415-420,621-628／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-365 | 重大 | 26 外部連携 | 受信署名が本文のみで再送攻撃を防げない | unmapped | — | — | — | — | consolidated §2 F26-S-04／feature-26.md／apps/worker/src/routes/webhooks.ts:931-940／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-366 | 重大 | 26 外部連携 | 送る直前のSSRF再検査がなく古いhttp行が有効なまま飛び続ける | 本流統合（#660配備追補をPR審査中） | [#642](https://github.com/kentavndng/line-harness-board/issues/642) / [#660](https://github.com/kentavndng/line-harness-board/issues/660) | [#1463](https://github.com/skmtmst/line-harness-oss/pull/1463) / [#1478](https://github.com/skmtmst/line-harness-oss/pull/1478) | 208/[#1482](https://github.com/skmtmst/line-harness-oss/pull/1482) | 未反映（[#264](https://github.com/kentavndng/line-harness-board/issues/264)で確認待ち） | consolidated §2 F26-S-05／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:64-95、apps/worker/src/services/automation-action-executors.ts:422-444,468／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-367 | 中 | 26 外部連携 | 未照合時の選択肢（未照合箱・候補作成）が何もしない | unmapped | — | — | — | — | consolidated §2 F26-S-06／feature-26.md／apps/worker/src/services/incoming-webhook-actions.ts:98-166／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-368 | 中 | 26 外部連携 | 削除が物理削除で履歴・監査方針と合わない | unmapped | — | — | — | — | consolidated §2 F26-S-07／feature-26.md／packages/db/src/webhooks.ts:461-469,536-539、apps/worker/src/services/webhook-interactions.ts:54-56／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-369 | 中 | 26 外部連携 | 送り直しは最大5回・数秒待ちで長時間障害は救えない | unmapped | — | — | — | — | consolidated §2 F26-M-01／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:12-17、apps/worker/src/routes/webhooks.ts:185-189／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-370 | 中 | 26 外部連携 | 配送キュー・outboxがなく連動送信は同期的逐次fetch | unmapped | — | — | — | — | consolidated §2 F26-M-02／feature-26.md／apps/worker/src/services/event-bus.ts:193-260、apps/worker/src/services/outgoing-webhook-delivery.ts:82／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-371 | 中 | 26 外部連携 | 送るデータの形が3経路でバラバラで共通封筒と違う | unmapped | — | — | — | — | consolidated §2 F26-M-03／feature-26.md／apps/worker/src/services/event-bus.ts:198-202、apps/worker/src/services/automation-action-executors.ts:470-474、apps/worker/src/routes/webhooks.ts:762-766／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-372 | 中 | 26 外部連携 | 署名・冪等ヘッダの名前が経路で違う | unmapped | — | — | — | — | consolidated §2 F26-M-04／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:72-76、apps/worker/src/services/automation-action-executors.ts:475-479／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-373 | 中 | 26 外部連携 | 通常送信にタイムアウトがなく相手の無応答に引きずられる | unmapped | — | — | — | — | consolidated §2 F26-M-05／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:82／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-374 | 中 | 26 外部連携 | Retry-Afterを見ず混雑時の再送が空振りする | unmapped | — | — | — | — | consolidated §2 F26-M-06／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:12-28、apps/worker/src/services/external-delivery-retry.ts:78-89／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-375 | 中 | 26 外部連携 | 連続失敗の通知・自動停止がなくカウンタが増えるだけ | unmapped | — | — | — | — | consolidated §2 F26-M-07／feature-26.md／apps/worker/src/services/outgoing-webhook-delivery.ts:97-129／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-376 | 中 | 26 外部連携 | 連動側の種別読取りに壊れ対策がなく1行壊れると全送り先が止まる | unmapped | — | — | — | — | consolidated §2 F26-M-08／feature-26.md／packages/db/src/webhooks.ts:560-563、apps/worker/src/routes/webhooks.ts:63-72／Worker114件＋Web50件PASS/コード読み/確度中（blast radiusは要実機R-06）／#617 |
| N-377 | 中 | 26 外部連携 | 検証済みメアド・電話の照合に検証の裏付けがない | unmapped | — | — | — | — | consolidated §2 F26-M-09／feature-26.md／apps/worker/src/services/incoming-webhook-actions.ts:46-58／Worker114件＋Web50件PASS/コード読み/確度中（users全列未精査）／#617 |
| N-378 | 中 | 26 外部連携 | 人が見つからない・処理なしでも送り主に成功を返す | unmapped | — | — | — | — | consolidated §2 F26-M-10／feature-26.md／apps/worker/src/routes/webhooks.ts:1006-1037、apps/worker/src/services/incoming-webhook-actions.ts:110-114／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-379 | 中 | 26 外部連携 | 作成・公開・停止・合言葉更新・やり直しの監査記録がない | unmapped | — | — | — | — | consolidated §2 F26-M-11／feature-26.md／apps/worker/src/routes/webhooks.ts全体（audit言及0）／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-380 | 中 | 26 外部連携 | 外部から呼ぶ公開APIトークンの仕組みがない | unmapped | — | — | — | — | consolidated §2 F26-M-12／feature-26.md／リポジトリ内grep（api_tokens該当なし）／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-381 | 中 | 26 外部連携 | 見本14タブが別機能（通知設定）を開く | unmapped | — | — | — | — | consolidated §2 F26-M-13／feature-26.md／apps/web/src/app/webhooks/page.tsx:29-34,341,599／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-382 | 中 | 26 外部連携 | 停止・開始の二重押しで意図と逆になる | unmapped | — | — | — | — | consolidated §2 F26-M-14／feature-26.md／apps/web/src/app/webhooks/page.tsx:178-208／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-383 | 中 | 26 外部連携 | 送る出来事が自由入力＋*規約で誤記が無音の不達になる | unmapped | — | — | — | — | consolidated §2 F26-M-15／feature-26.md／apps/web/src/app/webhooks/new/page.tsx:78-87、apps/worker/src/routes/webhooks.ts:209-220／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-384 | 中 | 26 外部連携 | 受信に本文上限・回数制限・IP制限がない | unmapped | — | — | — | — | consolidated §2 F26-M-16／feature-26.md／apps/worker/src/routes/webhooks.ts:919-963／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-385 | 軽 | 26 外部連携 | 設定メニューがマウス前提（Esc・外側・キーボードで閉じない） | unmapped | — | — | — | — | consolidated §2 F26-L-01／feature-26.md／apps/web/src/app/webhooks/webhook-overviews.tsx:350-372／Worker114件＋Web50件PASS/コード読み/確度中（実機未確認）／#617 |
| N-386 | 軽 | 26 外部連携 | 狭幅で記録表が6列のまま（はみ出しの恐れ） | unmapped | — | — | — | — | consolidated §2 F26-L-02／feature-26.md／apps/web/src/app/webhooks/webhook-interactions.tsx:305-321／Worker114件＋Web50件PASS/コード読み/確度中（実機未確認）／#617 |
| N-387 | 軽 | 26 外部連携 | まとめてやり直しが先頭5件だけで残りは無言で置いていく | unmapped | — | — | — | — | consolidated §2 F26-L-03／feature-26.md／apps/worker/src/routes/webhooks.ts:889-915、apps/web/src/app/webhooks/webhook-interactions.tsx:215-235／Worker114件＋Web50件PASS/コード読み/確度高／#617 |
| N-388 | 軽 | 26 外部連携 | 試し送信が確認なしで実URLへ飛ぶ | unmapped | — | — | — | — | consolidated §2 F26-L-04／feature-26.md／apps/worker/src/routes/webhooks.ts:752-785、apps/web/src/app/webhooks/webhook-overviews.tsx:181-208／Worker114件＋Web50件PASS/コード読み/確度高／#617 |

### 機能27 予約管理

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-389 | 中 | 27 予約管理 | 予約内容の変更ができない（日時・担当・メニュー・料金） | unmapped | — | — | — | — | consolidated §2 F27-M-1／feature-27.md／apps/web/src/app/booking/bookings/page.tsx:771、detail/page.tsx:321-326,373-381／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-390 | 中 | 27 予約管理 | 電話客（LINE未連携）に送りますと表示してしまう | unmapped | — | — | — | — | consolidated §2 F27-M-2／feature-27.md／apps/web/src/app/booking/bookings/new/page.tsx:480-495,549-555、detail/page.tsx:397-407、apps/worker/src/routes/booking.ts:1875-1880／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-391 | 中 | 27 予約管理 | 確認・リマインダを送らない選択ができない | unmapped | — | — | — | — | consolidated §2 F27-M-3／feature-27.md／apps/web/src/lib/api.ts:9342-9356、apps/web/src/app/booking/bookings/new/page.tsx:318-334、apps/worker/src/routes/booking.ts:1656-1659／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-392 | 中 | 27 予約管理 | Google同期失敗の再試行手段がない | unmapped | — | — | — | — | consolidated §2 F27-M-4／feature-27.md／apps/worker/src/routes/booking.ts（sync/retry不在）、apps/worker/src/services/booking-calendar-sync.ts:62-130／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-393 | 中 | 27 予約管理 | 通知失敗の再試行・失敗確認が弱い | unmapped | — | — | — | — | consolidated §2 F27-M-5／feature-27.md／apps/web/src/app/booking/bookings/page.tsx:813-818、detail/page.tsx:397-407／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-394 | 中 | 27 予約管理 | いつ誰が何を変えたかの履歴がない | unmapped | — | — | — | — | consolidated §2 F27-M-6／feature-27.md／apps/worker/src/routes/booking.ts:2549-2637（監査行なし）／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-395 | 中 | 27 予約管理 | リマインダ時刻が全部屋固定で設定で変えられない | unmapped | — | — | — | — | consolidated §2 F27-M-7／feature-27.md／apps/worker/src/services/booking-confirm.ts:15-26、apps/worker/src/services/booking-types.ts:100-105／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-396 | 軽 | 27 予約管理 | 顧客向け予約履歴URLを管理画面で発行できない | unmapped | — | — | — | — | consolidated §2 F27-L-1／feature-27.md／apps/web/src/app/booking/bookings/page.tsx:621-657／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-397 | 軽 | 27 予約管理 | 予約台帳のCSV書出しがない | unmapped | — | — | — | — | consolidated §2 F27-L-2／feature-27.md／booking配下のcsv検索0件／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-398 | 軽 | 27 予約管理 | 絞り込み不足（完了・来店なしタブ、担当者・種別絞りなし） | unmapped | — | — | — | — | consolidated §2 F27-L-3／feature-27.md／apps/web/src/app/booking/bookings/page.tsx:24-31、apps/worker/src/routes/booking.ts:2485-2493／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-399 | 軽 | 27 予約管理 | 空きセルから代理予約を開始できない | unmapped | — | — | — | — | consolidated §2 F27-L-4／feature-27.md／apps/web/src/app/booking/booking-calendar.tsx:107-109／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-400 | 軽 | 27 予約管理 | ブラウザ再読込で入力が消える（下書き保存なし） | unmapped | — | — | — | — | consolidated §2 F27-L-5／feature-27.md／apps/web/src/app/booking/bookings/new/page.tsx:75-137／Worker85件＋Web80件＋DB9件PASS/コード読み/確度高／#617 |
| N-401 | 軽 | 27 予約管理 | 読取り専用の人にも操作ボタンが見える | unmapped | — | — | — | — | consolidated §2 F27-L-6／feature-27.md／apps/web/src/middleware/auth.ts:376、apps/worker/src/middleware/role-guard.ts:15-28／Worker85件＋Web80件＋DB9件PASS/コード読み/確度中／#617 |

### 機能28 予約設定

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-03 | 中 | 28 予約設定 | 予約メニューを作る時点で予約後の自動タグを選べない | PR審査 | [#657](https://github.com/kentavndng/line-harness-board/issues/657) | [#1480](https://github.com/skmtmst/line-harness-oss/pull/1480) | 列車待ち | 未反映 | phase0-m2 E-03／booking/menus/new→booking API経路、Web28件PASS／#618 |
| E-05 | 軽 | 28 予約設定 | 休止中メニューの担当欄が割当済みでも「だれもいません」と誤表示する | unmapped | — | — | — | — | phase0-m2 E-05／booking/menus/page.tsxの担当表示分岐、契約6件PASS／#618 |
| E-09 | 中 | 28 予約設定 | 登録した例外日を画面から修正・削除できない | unmapped | — | — | — | — | phase0-m2 E-09／画面→client→Worker→DB経路、Worker11件・Web6件PASS／#618 |
| N-402 | 重大 | 28 予約設定 | 休業日・例外日を作っても実際の空きに反映されない | PR審査 | [#651](https://github.com/kentavndng/line-harness-board/issues/651) | [#1471](https://github.com/skmtmst/line-harness-oss/pull/1471) | 列車待ち | 未反映 | consolidated §2 F28-S-01／feature-28.md／apps/worker/src/services/availability.ts（例外参照0件）、apps/web/src/app/booking/staff/shifts/page.tsx:122-138／実行テスト件数は原文断片に記載なし/コード読み（grep）/確度高／#617 |
| N-403 | 重大 | 28 予約設定 | 店舗の営業時間が実際の空きの開閉に反映されない | unmapped | — | — | — | — | consolidated §2 F28-S-02／feature-28.md／apps/worker/src/services/availability.ts:225-229,335-340,349-355／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-404 | 中 | 28 予約設定 | 一覧の金額が料金モードを無視しお問い合わせを無料と表示する | unmapped | — | — | — | — | consolidated §2 F28-S-03／feature-28.md／apps/web/src/app/booking/menus/page.tsx:324-325、apps/web/src/app/booking/menus/new/page.tsx:101-110／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-405 | 重大 | 28 予約設定 | 担当者の勤務・休憩・シフト・外部カレンダーを操作する画面がない | 修正中（依存待ち） | [#655](https://github.com/kentavndng/line-harness-board/issues/655) | — | — | 未反映 | consolidated §2 F28-S-04／feature-28.md／apps/worker/src/routes/booking.ts:2189-2471（APIのみ）、apps/web/src/app/booking/staff/shifts/page.tsx（staff_id参照なし）／実行テスト件数は原文断片に記載なし/コード読み（画面呼出grep0件）/確度高／#617 |
| N-406 | 重大 | 28 予約設定 | 店舗の受付時間・基本ルール・資源を編集する手段がない | unmapped | — | — | — | — | consolidated §2 F28-S-05／feature-28.md／apps/worker/src/routes/booking.ts:930,943（GETのみ）、apps/web/src/app/booking/menus/page.tsx:408／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-407 | 中 | 28 予約設定 | メニュー編集のモーダル保存が版チェックなし全体PUTで同時編集に負ける | unmapped | — | — | — | — | consolidated §2 F28-M-01／feature-28.md／apps/web/src/app/booking/menus/page.tsx:148-153、apps/worker/src/routes/booking.ts:1298-1385／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-408 | 中 | 28 予約設定 | メニュー編集モーダルで料金モードを変えられない | unmapped | — | — | — | — | consolidated §2 F28-M-02／feature-28.md／apps/web/src/app/booking/menus/page.tsx:531-564／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-409 | 中 | 28 予約設定 | スタッフ一覧のシフトリンクが別人の店舗画面へ飛ぶ | unmapped | — | — | — | — | consolidated §2 F28-M-03／feature-28.md／apps/web/src/app/booking/staff/page.tsx:181、apps/web/src/app/booking/staff/shifts/page.tsx／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-410 | 中 | 28 予約設定 | メニュー×担当の一括保存が非原子的で大量時は遅く壊れやすい | unmapped | — | — | — | — | consolidated §2 F28-M-04／feature-28.md／apps/web/src/app/booking/menus/staff/page.tsx:89-115、apps/worker/src/routes/booking.ts:2164-2184／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-411 | 中 | 28 予約設定 | 役割の粒度が要件より粗くスタッフは書込全面不可・画面も出し分けなし | unmapped | — | — | — | — | consolidated §2 F28-M-05／feature-28.md／apps/worker/src/routes/booking.ts:1234,1298,1387,1458他、apps/web/src/app/booking/menus/page.tsx:347-352／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |
| N-412 | 中 | 28 予約設定 | スタッフの作成・更新に入力検証がなく空名で保存できる | unmapped | — | — | — | — | consolidated §2 F28-M-06／feature-28.md／apps/worker/src/routes/booking.ts:2027-2060,2062-2098／実行テスト件数は原文断片に記載なし/コード読み/確度高／#617 |

### 機能29 イベント予約

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-414 | 重大 | 29 イベント予約 | 制限なしなのに同じ人の2回目申込が捨てられる | unmapped | — | — | — | — | consolidated §2 F29-S-1／feature-29.md／apps/worker/src/routes/events.ts:1345,1431／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |
| N-415 | 重大 | 29 イベント予約 | 繰上げの承諾する口がどこにもない（トークン付きURLが死んでいる） | unmapped | — | — | — | — | consolidated §2 F29-S-2／feature-29.md／apps/worker/src/services/event-waitlist.ts:639、apps/liff/src/App.tsx:14／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |
| N-416 | 重大 | 29 イベント予約 | 満席の枠はLIFFから待ちに入れず競合時は確定と誤表示する | unmapped | — | — | — | — | consolidated §2 F29-S-3／feature-29.md／apps/liff/src/pages/Event.tsx:130、apps/worker/src/routes/events.ts:1328、apps/liff/src/pages/EventConfirm.tsx:65、apps/liff/src/pages/EventDone.tsx:7／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高（実タップは要実機）／#617 |
| N-417 | 中 | 29 イベント予約 | 申込者への一斉送信・CSV・個別トークの口がない | unmapped | — | — | — | — | consolidated §2 F29-M-1／feature-29.md／apps/web/src/app/events/bookings/page.tsx:315、apps/worker/src/routes/events.ts（export/broadcastなし）／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |
| N-418 | 中 | 29 イベント予約 | 公開後の変更が版なしで上書きされ過去の申込表示まで変わる | unmapped | — | — | — | — | consolidated §2 F29-M-2／feature-29.md／apps/worker/src/routes/events.ts:413／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |
| N-419 | 中 | 29 イベント予約 | 待ちの行・順番・手動案内が管理画面に出ない | unmapped | — | — | — | — | consolidated §2 F29-M-3／feature-29.md／apps/web/src/app/events/event-load-state-contract.test.ts:65（listWaitlist未使用を固定）／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |
| N-420 | 軽 | 29 イベント予約 | 参加済・無断ボタンの連打で成功しても失敗文が出る | 本流統合・検証反映済み | [#684](https://github.com/kentavndng/line-harness-board/issues/684) | [#1500](https://github.com/skmtmst/line-harness-oss/pull/1500) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F29-L-1／feature-29.md／apps/web/src/app/events/bookings/page.tsx:278／Worker117件＋Web122件＋DB10件PASS/コード読み/確度中（連打実機は未実施）／#617 |
| N-421 | 軽 | 29 イベント予約 | 一覧上部の件数帯がタブに見えるが押せない | 本流統合・検証反映済み | [#684](https://github.com/kentavndng/line-harness-board/issues/684) | [#1500](https://github.com/skmtmst/line-harness-oss/pull/1500) | 213/[#1513](https://github.com/skmtmst/line-harness-oss/pull/1513) | 52回目 | consolidated §2 F29-L-2／feature-29.md／apps/web/src/app/events/page.tsx:148／Worker117件＋Web122件＋DB10件PASS/コード読み/確度中（見た目解釈含む）／#617 |
| N-422 | 軽 | 29 イベント予約 | 承認期限が固定24時間でイベントごとに変えられない | unmapped | — | — | — | — | consolidated §2 F29-L-3／feature-29.md／apps/worker/src/services/event-booking-types.ts:104、apps/worker/src/services/event-booking-expirer.ts:20／Worker117件＋Web122件＋DB10件PASS/コード読み/確度高／#617 |

### 機能30 ログインユーザー

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-423 | 中 | 30 ログインユーザー | 対応表に無いAPIはスタッフ権限で通る（deny-by-default未実装） | unmapped | — | — | — | — | consolidated §2 F30-S-01／feature-30.md／apps/worker/src/middleware/auth.ts:157-172,190-194,381-386／Web40件＋Worker90件PASS/コード読み/確度高（悪用範囲は要実機T-02）／#617 |
| N-424 | 中 | 30 ログインユーザー | 受付を選んで保存すると運用になる。項目別3択は飾り | unmapped | — | — | — | — | consolidated §2 F30-M-01／feature-30.md／apps/web/src/app/staff/page.tsx:144-168,182、apps/web/src/app/staff/staff-actions.ts:33-39／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-425 | 中 | 30 ログインユーザー | 招待の再送手段がない。期限切れは詰む（作り直しも409） | unmapped | — | — | — | — | consolidated §2 F30-M-02／feature-30.md／apps/worker/src/routes/staff.ts:314-316,318-374,556-568、apps/web/src/app/staff/page.tsx:341-376／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-426 | 中 | 30 ログインユーザー | 管理者の二段階認証の必須が強制されない（注意書きだけ） | unmapped | — | — | — | — | consolidated §2 F30-M-03／feature-30.md／apps/worker/src/routes/admin-auth.ts:208-222、packages/db/src/access-audit.ts:231／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-427 | 中 | 30 ログインユーザー | 自分の端末一覧・失効がなく高危険操作前の追加認証も画面にない | unmapped | — | — | — | — | consolidated §2 F30-M-04／feature-30.md／apps/worker/src/routes/access.ts、apps/worker/src/routes/staff.ts:541-554、apps/web/src/app/staff/page.tsx:361／Web40件＋Worker90件PASS/コード読み/確度高（不存在確認済み）／#617 |
| N-428 | 軽 | 30 ログインユーザー | ほかの人と同じにするボタンが何もしない | unmapped | — | — | — | — | consolidated §2 F30-L-01／feature-30.md／apps/web/src/app/staff/page.tsx:176／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-429 | 軽 | 30 ログインユーザー | 管理者が他人の入れていませんボタンを押すと必ず失敗する | unmapped | — | — | — | — | consolidated §2 F30-L-02／feature-30.md／apps/web/src/app/staff/page.tsx:355,375、apps/worker/src/routes/staff.ts:492／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-430 | 軽 | 30 ログインユーザー | いまいる人タブに利用停止中も混ざり件数と合わない | unmapped | — | — | — | — | consolidated §2 F30-L-03／feature-30.md／apps/web/src/app/staff/page.tsx:332,336、packages/db/src/access-audit.ts:191-201／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-431 | 軽 | 30 ログインユーザー | この人を外すラベルが編集窓を開く | unmapped | — | — | — | — | consolidated §2 F30-L-04／feature-30.md／apps/web/src/app/staff/page.tsx:375-376／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-432 | 軽 | 30 ログインユーザー | 招待期限が48時間のまま（要件は7日） | unmapped | — | — | — | — | consolidated §2 F30-L-05／feature-30.md／apps/worker/src/routes/staff.ts:19／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-433 | 軽 | 30 ログインユーザー | 自分のメール変更に確認メールが飛ばない | unmapped | — | — | — | — | consolidated §2 F30-L-06／feature-30.md／apps/worker/src/routes/staff.ts:406-414／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-434 | 軽 | 30 ログインユーザー | セッション期限が一律7日（要件は既定8時間・記憶時7日） | unmapped | — | — | — | — | consolidated §2 F30-L-07／feature-30.md／apps/worker/src/middleware/auth.ts:12／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-435 | 軽 | 30 ログインユーザー | 気になるもの絞りが失敗だけを見て成功の要確認を落とす | unmapped | — | — | — | — | consolidated §2 F30-L-08／feature-30.md／apps/web/src/components/staff/login-audit.tsx:134／Web40件＋Worker90件PASS/コード読み/確度高／#617 |
| N-436 | 軽 | 30 ログインユーザー | 保存するとこの場で切替わりますの実態は相手の強制ログアウト | unmapped | — | — | — | — | consolidated §2 F30-L-09／feature-30.md／apps/web/src/app/staff/page.tsx:185、apps/worker/src/routes/staff.ts:473-475、packages/db/src/staff.ts:338-344／Web40件＋Worker90件PASS/コード読み/確度高／#617 |

### 機能31 機能設定

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-06 | 中 | 31 機能設定 | 版なし旧保存口が成功を返しても、設定が読み直しで消える | unmapped | — | — | — | — | phase0-m4 E-06／テストDB再現、feature-settings.ts旧PUT経路／#507・#618 |
| N-437 | 重大 | 31 機能設定 | 稼働中でもoff保存が通り影響確認の口がない | PR審査 | [#643](https://github.com/kentavndng/line-harness-board/issues/643) | [#1466](https://github.com/skmtmst/line-harness-oss/pull/1466) | 列車待ち | 未反映 | consolidated §2 F31-S-01／feature-31.md／apps/worker/src/routes/feature-settings.ts（impact経路なし）、apps/web/src/app/settings/page.tsx:560／関連94件PASS/コード読み/確度高／#617 |
| N-438 | 中 | 31 機能設定 | 契約・依存の区別がなくoff理由が一律設定でオフ | unmapped | — | — | — | — | consolidated §2 F31-S-03／feature-31.md／packages/shared/src/feature-catalog.ts、apps/worker/src/services/feature-enforcement.ts:407-412／関連94件PASS/コード読み/確度高／#617 |
| N-439 | 中 | 31 機能設定 | カタログ10キーはAPI受付のみでUI・メニュー未配線 | unmapped | — | — | — | — | consolidated §2 F31-M-01／feature-31.md／apps/web/src/lib/feature-settings.ts:10-33、apps/web/src/lib/menu.ts／関連94件PASS/コード読み/確度高／#617 |
| N-440 | 中 | 31 機能設定 | 上のうち4キーは強制対象自体が存在しない | unmapped | — | — | — | — | consolidated §2 F31-M-02／feature-31.md／apps/worker/src/services/feature-enforcement.ts:48-193／関連94件PASS/コード読み（grep0件）/確度高／#617 |
| N-441 | 中 | 31 機能設定 | 並び順のサーバー検証が甘い | unmapped | — | — | — | — | consolidated §2 F31-M-03／feature-31.md／apps/worker/src/routes/feature-settings.ts:126-136、apps/web/src/lib/menu.ts:196-232／関連94件PASS/コード読み/確度高／#617 |
| N-442 | 中 | 31 機能設定 | 閲覧は一般staffも可能（要件はowner/adminのみ） | unmapped | — | — | — | — | consolidated §2 F31-M-04／feature-31.md／apps/worker/src/routes/feature-settings.ts:204-237、apps/worker/src/middleware/auth.ts:157-182／関連94件PASS/コード読み/確度中高／#617 |
| N-443 | 中 | 31 機能設定 | off後の予約実行停止はwebinar系のみ配線 | unmapped | — | — | — | — | consolidated §2 F31-M-05／feature-31.md／webinar-notifications.ts・webinar-reminders.tsのみ呼出（grep）／関連94件PASS/コード読み/確度中（他経路未精査・要実機R-03）／#617 |
| N-444 | 中 | 31 機能設定 | 変更理由・差分の監査がない | unmapped | — | — | — | — | consolidated §2 F31-M-06／feature-31.md／apps/worker/src/services/business-audit.ts:42-、apps/web/src/lib/api.ts:4609-4619／関連94件PASS/コード読み/確度高／#617 |
| N-445 | 軽 | 31 機能設定 | 未保存のまま戻る・再読込すると警告なし | unmapped | — | — | — | — | consolidated §2 F31-L-01／feature-31.md／apps/web/src/app/settings/page.tsx（beforeunload0件）／関連94件PASS/コード読み/確度高／#617 |
| N-446 | 軽 | 31 機能設定 | 初期値に戻すが確認なし・保存値でなく既定値へ | unmapped | — | — | — | — | consolidated §2 F31-L-02／feature-31.md／apps/web/src/app/settings/page.tsx／関連94件PASS/コード読み/確度高／#617 |
| N-447 | 軽 | 31 機能設定 | サイドバーは設定読込失敗・読込中に全表示 | unmapped | — | — | — | — | consolidated §2 F31-L-03／feature-31.md／apps/web/src/components/sidebar.tsx:99-123,168／関連94件PASS/コード読み/確度高／#617 |
| N-448 | 軽 | 31 機能設定 | 利用数バッジは8系統のみ | unmapped | — | — | — | — | consolidated §2 F31-L-05／feature-31.md／apps/web/src/app/settings/page.tsx／関連94件PASS/コード読み/確度高／#617 |

### 機能32 運用状態

| ID | 重大度 | 機能 | 所見 | 状態 | Issue | PR | train | staging | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-449 | 重大 | 32 運用状態 | 停止しても主要な自動送信が止まらない | unmapped | — | — | — | — | consolidated §2 F32-S-1／feature-32.md／apps/worker/src/services/webinar-notifications.ts:574-577（唯一の参照）、packages/db/src/operations.ts:172／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高（実送信は未実施）／#617 |
| N-450 | 中 | 32 運用状態 | 異常が出ても誰にも通知が来ない（確認・受領の仕組みもない） | unmapped | — | — | — | — | consolidated §2 F32-M-1／feature-32.md／apps/worker/src/services/operations-health.ts:149-168、apps/worker/src/routes/operations.ts:126-267／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-451 | 中 | 32 運用状態 | 復旧前に止めている間に変わったことを見ない | unmapped | — | — | — | — | consolidated §2 F32-M-2／feature-32.md／apps/worker/src/routes/operations.ts:382-462、packages/db/src/operations.ts:392-406、apps/web/src/app/emergency/page.tsx:499-511／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-452 | 中 | 32 運用状態 | 配信処理のチェックが自動処理の滞留しか見ていない | unmapped | — | — | — | — | consolidated §2 F32-M-3／feature-32.md／apps/worker/src/services/operations-health.ts（dispatch_jobs検査）、apps/web/src/app/emergency/page.tsx:83／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-453 | 中 | 32 運用状態 | 止められない理由が画面に出ない | unmapped | — | — | — | — | consolidated §2 F32-M-4／feature-32.md／apps/web/src/app/emergency/page.tsx:398-402,470-471,494-497、apps/worker/src/routes/operations.ts:40-48／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-454 | 軽 | 32 運用状態 | 止めた回数が表示期間とずれる | unmapped | — | — | — | — | consolidated §2 F32-L-1／feature-32.md／apps/web/src/app/emergency/page.tsx:534-545,607-612／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-455 | 軽 | 32 運用状態 | 競合（409）後に読み直すボタンがない | unmapped | — | — | — | — | consolidated §2 F32-L-2／feature-32.md／apps/web/src/app/emergency/page.tsx:359-378,405-445／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-456 | 軽 | 32 運用状態 | 見るだけで監査記録が増える | unmapped | — | — | — | — | consolidated §2 F32-L-3／feature-32.md／apps/web/src/app/emergency/page.tsx:224-227、apps/worker/src/routes/operations.ts:184-207／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |
| N-457 | 軽 | 32 運用状態 | 停止中の選択欄がキーボードでは触れる | unmapped | — | — | — | — | consolidated §2 F32-L-4／feature-32.md／apps/web/src/app/emergency/page.tsx:452-468,494-497／Web47件＋Worker20件＋DB5件PASS/コード読み/確度中（実機未実施）／#617 |
| N-458 | 軽 | 32 運用状態 | いますぐ確かめるを連打できる | unmapped | — | — | — | — | consolidated §2 F32-L-5／feature-32.md／apps/web/src/app/emergency/page.tsx:669-676、apps/worker/src/services/operations-health.ts:149-156／Web47件＋Worker20件＋DB5件PASS/コード読み/確度高／#617 |

## 更新ルール

- 対応IssueがN/E-IDを明記した時だけ `unmapped` から更新します。題名の類似だけでは結び付けません。
- PR作成、列車受け入れ、本流統合、検証反映は別状態として、各一次資料を確認後に進めます。
- 見送りは理由と判断元Issueを必須にします。未確認項目を見送り・修正済みへ変えません。
- 集計更新時は、ID一意性、418行、重大42・中232・軽144、10列を機械検査します。
