# V6 データ移行・API・受け入れテスト計画

更新日: 2026-08-26
対象: 全32機能の実装・検証・切替

## 0. 結論

現行データを壊さずV6へ移す方法は、旧構造を画面に残すことではない。旧データを移行元・監査履歴として保持し、新schemaへadditiveに移し、shadow比較後にread/writeを切り替える。

```text
棚卸し → 追加schema → dry-run → backfill → shadow比較
      → canary → read切替 → write切替 → 監視 → 旧read停止
```

物理削除・列削除・旧table dropは初回cutoverに含めない。

## 1. 機能ごとの移行台帳

各親Issueに次を必須添付する。

| 項目 | 内容 |
|---|---|
| 旧正本 | table/API/job/外部provider |
| 新正本 | entity/version/event/read model |
| key対応 | old ID→new ID、account/friend/source |
| 件数 | 全件、account別、状態別 |
| 金額/残高 | currency別、credit/debit、snapshot |
| 欠損 | account不明、friend不明、壊れたJSON |
| 重複 | unique候補、採用規則、隔離数 |
| 変換 | 値mapping、timezone、version 1 |
| 外部副作用 | shadow時に禁止する送信/point/予約 |
| rollback | 戻すflag、戻せない操作、補償手順 |
| 保持 | 旧dataのread-only期間・削除条件 |

空欄は禁止。未決定は「未決定・決定者・期限」と書く。

## 2. Phase A: 棚卸し

- parent/LINE両worktreeの状態確認
- 本番/検証環境、migration適用番号、code SHA
- table row count、index、constraint、foreign key
- account/organization null、orphan、重複
- JSON parse失敗、enum外、timestamp/timezone不明
- secret混入、public URL、PII平文
- pending/retry/processingが止まっているjob
- 外部provider側の件数・残高・status

出力はPIIを含まない集計とerror IDだけ。顧客本文、token、URL queryを資料へ載せない。

## 3. Phase B: 追加schema

- 新table/column/indexはadditive
- nullable追加→backfill→constraintの順
- unique constraint前に重複を隔離
- `organization_id`/`line_account_id`を最初に追加
- version/event/auditは旧recordを参照できるsource keyを持つ
- 金額はminor unit＋currency
- timestampはUTC保存＋表示timezone。既存JST文字列はsource timezoneを明記して変換
- secretは暗号化tableへ移し、通常recordから分離

大量index/backfillはbatchとcheckpointを使い、lock/CPU/Queue影響を計測する。

## 4. Phase C: Dry-runとBackfill

dry-runは書込予定を次で出す。

- insert/update/skip/quarantine件数
- account別・状態別内訳
- ID collision、unique violation、orphan
- 金額/残高の旧新差
- JSON/日付/enum変換error
- 予想実行時間とbatch数

backfill規則:

- deterministic。再実行して同じ結果
- source ID＋migration versionで冪等
- checkpoint、resume、cancel
- error一件で全件を無言skipしない
- 外部LINE、point、Webhook、calendar、決済を発火しない
- legacy recordから「送信済み」を再送しない

## 5. Phase D: Shadow

### Shadow read

同じ入力に旧APIと新APIを実行し、応答を安全に正規化して比較する。

- 件数
- ID集合
- 状態
- 金額/残高
- 日付
- 集計値と分母
- permissionによる可視件数

差を`expected / data defect / implementation defect / unavailable`に分類する。

### Shadow write

業務writeを旧正本へ行い、新正本へprojectionする。ただし新側の外部副作用は無効にする。新actionは`shadow_succeeded`等の検証状態にし、本番送信と混ぜない。

## 6. Phase E: CanaryとCutover

- feature flagをorganization/account単位にする
- 内部test account→検証account→少数本番accountの順
- read切替を先、write切替を後
- external副作用は一種類ずつ
- canary中の旧新二重workerを防ぐlease/owner flag
- error rate、Queue lag、duplicate、amount mismatch、permission deniedを監視
- rollback閾値を事前定義

cutover当日:

1. clean tree、対象SHA、migration番号確認
2. backupとrestore testの記録
3. pending jobと外部provider状態をsnapshot
4. additive migration
5. backfill差分
6. shadow最終照合
7. read flag切替
8. smoke
9. write/dispatcher owner切替
10. external副作用canary
11. 監視と結果記録

## 7. Rollback

rollbackは「旧codeへ戻す」だけでは足りない。

- read flagを旧へ戻す
- 新dispatcherを停止し、旧dispatcher ownerを一つだけ再開
- cutover後に新側だけへ入ったwriteをexport
- 外部送信・point・calendar・決済の成功をidempotency keyで照合
- 二重実行をせず、必要ならcompensating adjustment
- migrationで追加したtable/columnは残す。急いでdropしない
- 原因、影響account、件数、補償、再開条件を記録

送信済みLINEは取消不能。誤送信時は停止、対象特定、訂正方針の人判断へ進む。

## 8. API受け入れ共通test

### Scope・権限

- 別organization/account IDで0件または404/403
- ID直接指定で越境不可
- staff/manager/admin/ownerのmatrix
- 未分類endpointは拒否
- 項目マスク、export、original、secret
- role変更後session失効

### Version・競合

- published version更新不可
- expected version不一致409
- 新版公開で既存binding/jobが変わらない
- concurrent approve/book/settleで一件だけ成功

### 冪等・再試行

- 同じIdempotency-Keyで一回
- 同じprovider event IDで一回
- timeout後retryで副作用一回
- 成功済みaction＋別action失敗から、失敗だけ再試行
- retry上限後permanent failedと要対応

### 状態

- loading/empty/error/permission/feature off/conflict
- cancelled/archived対象へのwrite拒否
- kill switch中にdispatcherが実行しない
- pause解除後、古いjobを無条件一括実行しない

### 入力・安全

- oversized/malformed/unsupported MIME
- HMAC/replay/timestamp
- SSRF/private IP/redirect/DNS rebinding
- CSV formula、危険文字、encoding
- XSS、HTML/URL sanitization
- secret/PIIがlog/errorへ出ない

## 9. データ受け入れtest

- old/new row count
- account別・状態別count
- source IDの一対一対応
- orphan 0、または承認済みquarantine件数
- unique collision 0
- 金額、mile、point、scoreのsum/ledger balance
- sent/failed/skipped総数
- timezone境界、月末、うるう日、DST対象timezone
- historyから当時のversion/amount/contentを再現
- archive後も過去executionを参照
- unavailable値が0へ変わっていない

金額・残高・支払は1円差でも自動承認しない。件数差は既知除外理由ごとに説明可能にする。

## 10. UI/UX受け入れtest

各画面で次を固定する。

- V6実Node ID
- 対象状態一覧
- 1920px設計画像
- 1920px実装画像
- 1440px実装画像
- reference＋implementationの横並び比較

確認:

- 位置、寸法、文字、色、余白、border、radius、shadow
- button名で行き先が分かる
- header actionの最後はmanual
- 作成・追加は左、対象操作は右
- sticky footerの削除は左、他操作は中央
- 主要一覧に横scrollなし
- 短い文字を単語途中で改行しない
- empty-createとempty-filterを区別
- `準備中`、無効button、遷移なしbuttonが0
- keyboard、focus、label、contrast

画像があるだけで一致扱いにせず、差分を目視記録する。

## 11. 機能E2Eの標準シナリオ

各機能で最低限5本:

1. 主タスクの正常完了
2. 権限不足
3. 空または対象なし
4. 外部/内部一時失敗→retry成功
5. 競合または二重実行防止

金額・配信・予約・審査は追加:

- 外部成功/DB失敗のreconciliation
- DB成功/外部失敗
- stop/feature off/kill switch
- archive/withdraw/refund/cancel後の履歴
- account越境

## 12. 性能・容量

- 主要一覧p95目標と最大page sizeを機能ごとに決める
- dashboard/analyticsはaggregateから読み、全scanしない
- Queue throughput、rate limit、retry stormを負荷test
- exportは非同期
- backfillは本番trafficへ上限を設定
- 1440/1920のrenderと操作応答を確認
- 送信枠、provider quota、storage、CDNの予算alert

数値目標は本番件数棚卸し後に設定する。根拠なしの「1分以内」を要件にしない。

## 13. Go / No-Go

### Go

- clean tree・対象SHA一致
- backup/restore確認
- migration dry-run差分説明済み
- mandatory tests/checks成功
- PR clean/mergeable
- V6画像比較完了
- rollback手順と担当者
- alert/kill switch/reconcile画面

### No-Go

- account不明データを自動割当
- 金額/残高差
- scope/security test失敗
- provider副作用の冪等性未確認
- pending job ownerが二つ
- secret/PII露出
- V6実Node/比較画像なし
- worktree dirty
- rollback不可の破壊migration

## 14. 本番反映後

- 最初の15分、1時間、24時間、7日で確認
- error、Queue、duplicate、scope deny、amount mismatch
- external providerとのreconciliation
- customer/operator complaintとsupport ticket
- metric freshnessとaggregate drift
- 旧readは最低2 release window保持
- cleanup/dropは別Issue・別承認

本計画を機能ごとの受け入れchecklistへ複製し、空欄を埋めてから実装完了とする。
