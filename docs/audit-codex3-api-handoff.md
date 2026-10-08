# 監査3本目：画面が待っているAPIの引き継ぎ（2026-10-08）

9件を実装・コミット。WEB039とWEB208は保存する情報の追加が必要なので、migrationを作らず保留した。画面変更、push、PR、DB更新、配備はしていない。

- ブランチ：`codex/codex-audit-fix3-10081718`
- 最終検証前に取り込んだ本線：`f7255f2fda`（`origin/codex/development`、競合なし）
- 開始前doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` → 合格
- 反映履歴：`docs/release-log/unreleased/audit-codex3.md`。PR採番は司令塔が行う。
- 2本目の担当機能は変更していない。`lib/api.ts`、DB/sharedのexport、OpenAPIの登録は同じファイルに追加するため、統合時は双方の追加を残す。

## APIごとの結果

| ID | 結果・コミット | 関連試験で確認したこと |
| --- | --- | --- |
| WEB052 | 作った：`c2467f6cfc` | 実D1で2件目の版が古い場合・他アカウントの場合に1件目も更新されない。正常時は全件と版履歴を保存。OpenAPIと権限ガードも検査 |
| WEB074 | 作った：`c3cf4a1964` | 付与101件の後ろにある使用・取り消しを、ページ分割前に絞って取得。総件数とoffset、不正種類の400 |
| WEB075 | 作った：`ded23c0e4a` | 友だちID、種類、理由検索、offsetで取得。全履歴の種類別件数・確定待ち・今月付与。別アカウントの非公開履歴を除外 |
| WEB084 | 作った：`403933508b` | 105件の予定から近い順に取得。全件から24時間以内を集計。実行済みだけをページ分割前に絞り、権限の範囲を維持 |
| WEB232 | 作った：`dfd18008ef` | incoming/outgoingをinactiveで直接INSERTし、イベントの送信対象に入らない。省略時の従来動作、権限、step-upも維持 |
| WEB039 | 作れなかった | ページ訪問と友だちの紐づけはあるが、新規友だち追加の元ページを確定する記録がない。帰属ルールとmigrationの承認が必要 |
| WEB196 | 作った：`4431266249` | 同じ会員の候補をページをまたいで同じまとめ鍵にする。件数はアカウント・tenant内の全pending候補。高得点の重複と中得点の単独を区別 |
| WEB208 | 作れなかった | 現在は率0%が「案件の定額報酬を使う」を意味し、「報酬なし」を保存できない。方式を保持する列のmigration承認が必要 |
| WEB198 | 作った：`e6f596d1a3` | お客さま向けの実通知だけを数える。再試行7回でも1通、回復すると未解決件数から外れる。テスト送信・担当者通知・別アカウントは除外 |
| WEB205 | 作った：`c608316faa` | 同じキーの並行再送でも生成依頼1件。同じキーで条件変更は409。応答を失った後の再送・tenant/projectの分離 |
| WEB222 | 作った：`6493a84eeb` | IDのSQL引数上限を100にした実SQLiteで、201件の画像・面数と2ページ目・総件数を取得 |

クライアントの送信・受信契約7件も `75fea377a4` で検査した。各実装の関連試験後にworker/db/webの型検査を実施し、ステージ済み差分を検査してコミットした。

## 画面で置き換える呼び出し

### WEB052：予約メニューの並び

対象：`apps/web/src/v8/booking-menus/tabs/menus-tab.tsx` の `persistOrder`。

複数回の `bookingApi.updateMenu` と、失敗時に戻すための再更新を、次の1回に置き換える。

```ts
bookingApi.reorderMenus(accountId, {
  changes: affectedMenus.map(menu => ({
    id: menu.id,
    expectedVersion: menu.version,
    sortOrder: /* 変更後の位置 */ 0,
  })),
})
```

`PUT /api/booking/admin/menus/order?account_id=...`。変更行の版をすべて送り、成功時の `versions` を手元の行に反映する（予約の既存口と同じく、`{ ok: true, versions }` の応答でdataラッパーはない）。1行でも版・所属・削除状態が合わなければ409で全行を変更しない。409時は再取得する。「元に戻す」も、成功後の新しい版でこの口を使う。

### WEB074：全体のマイル履歴

対象：`apps/web/src/v8/mileage/history.tsx` の `load`。

「使った・取り消しのみ」は `api.mileage.history` に `entryTypes: ['reversal', 'spend', 'expiration', 'adjustment']` を渡す（現在の「grant以外」という画面の分類と同じ）。返ったページから付与を除く処理を削除し、`items` と `pagination.total` をそのまま使う。「付けたのみ」は既存の `entryType: 'grant'` を維持できる。

HTTPは既存の `GET /api/mileage/history`、複数種類は `entryTypes=spend,reversal`。単一種類・他のフィルタを併用した場合はAND条件。

### WEB075：友だち別のマイル履歴

対象：`apps/web/src/v8/mileage/friend-detail.tsx` の初回100件取得・手元の絞り込み/ページ分割/件数集計。

`api.mileage.history({ accountId, friendId, kind, search, from, to, limit, offset })` をページや条件の変更時に呼ぶ。`kind` は `earned | spent | voided`。`search` は友だち別では理由を検索する。全体一覧の検索は従来の名前検索。

- `items` と `pagination.total` は指定したフィルタの結果。
- `friendSummary.counts`（all/earned/spent/voided）、`pendingCount`、`earnedThisMonth`、`earnedCountThisMonth` は、ページ・種類・検索・日付に左右されない本人の集計。月は日本時間。
- `scope: 'visible_accounts'`：閲覧できるアカウントにある同じ人の明細。見えないアカウントも含むウォレット全体の数字として表示しない。
- `earned` はgrantと正のadjustment、`spent` はspend、`voided` は残り。既存の友だち別画面の分類に合わせた。

ウォレット残高・insightsの既存取得は残し、最初の100件から全件のように算出する処理を置き換える。

### WEB084：リマインダ詳細・予定・履歴

対象：`apps/web/src/v8/reminders/detail.tsx`。

- 詳細の直近5件：`api.reminders.runs(id, { executedOnly: true, order: 'recent_desc', limit: 5, offset: 0 })`。取得後にqueued/claimedを除く処理をやめる。
- 配信予定と予定のページ送り：`api.reminders.runs(id, { status: 'planned', order: 'scheduled_asc', limit, offset })`。plannedは従来どおりqueuedを表す。retry_waitを取得する場合の並び順には再試行日時を使う。
- 一時停止の「今後24時間で送る予定」：手元の先頭100件を数えず、`data.summary.scheduledNext24Hours` を使う。期限を過ぎても残っている未送分を含む（既存の7日集計と同じ）。通知ごとの次の予定には近い順の予定行を使う。
- `executedOnly` はqueued/claimedを除く。失敗して実行履歴があるretry_waitは含む。履歴タブで「実行済みだけ」を表示する際も指定する。

既存の `GET /api/reminders/:id/runs` を拡張した。集計はページや履歴フィルタに依存せず、閲覧権限内の全実行行から返す。

### WEB232：Webhook作成

対象：`apps/web/src/v8/webhooks/create.tsx` の `api.webhooks.outgoing.create(payload, stepUpToken)`。

`payload` に `isActive: false` を含める。作成後にupdateで停止する処理と、それに失敗したときの「稼働中に作成された」復旧処理を置き換える。DBに最初からinactiveで保存する。

incomingも `api.webhooks.incoming.create({ ...payload, isActive: false })` を利用可能（対象は `apps/web/src/v8/webhooks/incoming.tsx`）。どちらも省略時は従来どおりactiveで、既存利用者を一律に止めない。

### WEB039：流入リンクのサイトスクリプト（保留）

対象：`apps/web/src/v8/inflow-links/site-script.tsx` の `api.siteTracking.pages`（`GET /api/site/pages`）。訪問者数を新規追加数へ読み替えない。まだ置き換え先はない。

### WEB196：EC会員の重複の疑い

対象：`apps/web/src/v8/settings/ec-commerce/identity.tsx` の `api.ecCommerce.operationIdentityCandidates`。

呼び出しは同じ。各行の `isDuplicateSuspicion` で重複を判断し、`duplicateGroupKey` でまとめ、`duplicateCandidateCount` で候補数を表示する。点数が中程度という理由だけで重複扱いする処理を置き換える。

鍵はtenant/アカウント/会員の組み合わせから作る不透明な値。会員IDがない行はnull。候補が別ページにあっても同じ鍵・全件数を返す。`summary.duplicateSuspicions` は重複が疑われる会員の数であり、行数ではない。本人確認の確定処理は変えていない。

### WEB208：紹介者の報酬方式（保留）

対象：`apps/web/src/v8/affiliates/create.tsx` の `api.affiliates.create`。まだ方式を保存できる口はない。

### WEB198：LINE通知の送れなかった通数

対象：`apps/web/src/v8/settings/line-notifications/screen.tsx`。既存の `api.lineNotifications.sendCounts(accountId)` に返る `data.failures.total` を `customerNotificationKpis` の `failed: null` へ接続する。

`failures = { scope: 'all_time_unresolved', total, failed, retryWaiting }`。現在のfailedとretry_waitを数える。取込エラー数・送信試行回数・直近30日の失敗履歴ではない。回復済みは除く。読み込み失敗時は数字を0にせず、既存の取得失敗表示を維持する。

### WEB205：バナー生成

対象：`apps/web/src/v8/hq-banners/project.tsx` の `api.hqBanners.projects.createGeneration`。

第3引数に `{ idempotencyKey }` を渡す。1回の操作でキーを発行し、応答が届かなかった場合の再送でも同じキーを使う。条件を変えて新しく作る操作は別キー。

`POST /api/hq/banners/projects/:id/generations` は `Idempotency-Key` を受け、同じproject・tenant・キー・条件では元の依頼を201で返す。条件が異なれば409。既存の主キーを使うためmigration不要。キーなしの呼び出しは従来どおり。

### WEB222：リッチメニュー一覧

対象：`apps/web/src/v8/rich-menus/list.tsx` の `api.richMenuGroups.listPage`。呼び出しを変えずに修正が効く。最新本線にはtotalを見て200件ずつ全ページ取得する処理がすでにある。

IDの数だけSQL引数を増やす検索をやめ、JSON配列とアカウントの2引数で画像・面数を取得する。型 `RichMenuGroupListOptions` をsharedに切り出した。

## オーナーに決めてほしいこと

1. WEB039：どのページを新規友だち追加の元として数えるか（最初/最後の接点、初回追加と再追加、日付の基準）。follow確認と元ページを確定して記録する設計、およびmigrationの採番を承認してほしい。訪問後に手動・フォーム・LIFFで既存友だちと紐づいただけでは、新規追加の証拠にできない。
2. WEB208：`none / fixed / rate` などの報酬方式を保存する列の追加とmigration採番を承認してほしい。既存の正の率はrate、0%は従来のfixedとして扱う案。承認済みの過去報酬は再計算しない。

次は司令塔が9件の画面を接続し、保留2件の判断を取る。統合時に2本目の変更と照合し、PR番号つきの反映履歴へ整える。
