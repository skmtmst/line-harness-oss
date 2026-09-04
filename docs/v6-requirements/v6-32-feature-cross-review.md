# V6 全32機能 横断整合レビュー

更新日: 2026-08-26
対象: 全32要件定義、V6 Pencil、現行DB/API/実行処理

## 0. 結論

32本の要件は実装へ渡せる。ただし、同じ概念を機能ごとに別実装すると、二重送信、数字不一致、権限漏れ、公開後の書換えが再発する。以下の11項目を横断正本とし、機能別要件より優先する。

1. 組織・LINEアカウント境界
2. 認証・権限・項目マスク
3. 定義・版・公開・snapshot
4. event受信・正規化・action実行
5. job・再試行・停止・復旧
6. 配信・通知の共通台帳
7. media原本・派生asset・同意
8. 金額・mile・scoreの追記台帳
9. 分析用read modelと鮮度
10. archive・保持・監査
11. 移行・cutover・rollback

## 1. 正式な所属モデル

```text
organization
└─ line_account
   ├─ operator membership / role / permission
   ├─ friend
   ├─ definitions / versions
   ├─ receipts / events / executions
   └─ domain records
```

- `organization_id`: 契約主体・会社
- `line_account_id`: LINE公式アカウントと業務データの最小境界
- `operator_id`: 管理画面利用者
- `friend_id`: そのLINEアカウント内の友だち
- 同じLINE user IDでも別LINEアカウントのfriendは別record
- APIはURLまたは認証contextからaccountを解決し、bodyのaccount IDを信用しない
- account不明の旧データは推測で割り当てず隔離
- 組織横断表示は権限と明示的scopeがある集計APIだけ

## 2. 正式な版モデル

機能5〜13、16〜19、21、24、25、27〜29で版が必要である。別々の流儀を作らない。

```text
definition ──< immutable version
     │              │
     └ current draft│
                    └ publication ── effective_at / paused_at
                                         │
                                         └ job/action snapshot
```

- draftは編集可能
- published versionは不変
- 「編集」は前版から新しいdraftを作る
- 新版公開後の既存利用先の扱いは、次の2分類だけを使う。機能ごとに第3の流儀を作らない

| 分類 | 定義 | 挙動 | 該当 |
|---|---|---|---|
| 参照型利用先 | URLや定義IDで「定義そのもの」を指す公開面 | 公開時点の最新公開版を表示する。ただし開始済みの回答・実行は開始時の版で完走する | 回答フォームの回答URL(13)、LIFF画面、リッチメニューの公開alias(12)、予約ページ(28) |
| スナップショット型利用先 | 配信job、ステップ、挿入先、通知定義など「版を取り込んで動く」もの | 版を固定する。新版への切替は利用先ごとに件数と差分を確認してから行い、migration eventを記録する | シナリオ(05)、一斉配信(06)、リマインダ(07)、テンプレート挿入(11)、共通情報(14)、メディア(15)、通知(24)、オートメーション(25) |

- 各要件書の版の章に、その機能の利用先がどちらの分類かを1行で明記する
- queue済みjob/actionはversion IDとrender snapshotを保持
- 予約済み・待機中への新版適用は対象件数と差分を確認し、migration eventを記録
- deleteではなくarchive。過去実行から参照できる

## 3. eventと実行の正式モデル

18、19、20、23、25、26が別々の「共通イベント台帳」を作ってはいけない。役割を分けて一つにする。

```text
external receipt / internal fact
            ↓ normalize
        domain event
            ↓ match rules
        action execution
            ↓ enqueue
          job attempt
            ↓
 provider result / reconciliation
```

- `external_receipt`: Webhook raw body、署名、受信時刻、provider event ID
- `domain_event`: account、subject、event type、occurred_at、schema version、source reference
- `action_execution`: rule/action version、対象、idempotency key、結果
- `job_attempt`: claim、lease、attempt、next_retry_at、error、provider request ID
- `metric_event`: 分析用read modelへ投影した取得可能な事実
- raw receiptとdomain eventは同一物ではない
- 業務DBの正本を分析eventで置き換えない

## 4. 共通状態名

### 定義

`draft / published / paused / archived`

### 実行

`planned / queued / claimed / succeeded / skipped / retry_wait / permanent_failed / cancelled`

### 外部接続

`connected / degraded / paused / auth_expired / rate_limited / disconnected`

### データ鮮度

`fresh / delayed / stale / unavailable / partial`

### 画面

`loading / empty-create / empty-filter / error / permission_denied / feature_off / conflict`

機能固有状態はこれへ追加する。`failed`一語で一時失敗・恒久失敗・部分失敗を混ぜない。未取得を0にしない。

## 5. 横断矛盾と解決

### 5-1. マイルと行動スコア

17で分離済み。共通`point`モデルに戻さない。

- mileage: 顧客資産、失効・交換・残高・追記台帳
- score: 内部指標、顧客非表示、配信条件・優先度
- URLは`/mileage`配下に統一し、旧`/scoring`はredirect
- 22写真審査の「採用ポイント」は外部ECのポイントであり、mileageとは別の台帳。画面では「ECポイント」と呼び、「マイル」と混ぜない。17と22に相互参照を置く

### 5-2. 流入・コンバージョン・分析・EC

- 18はtouch/traffic/ad delivery
- 19は成果定義とconversion fact
- 20はread modelと分析結果
- 23はEC receipt/normalized commerce event
- 16は19の確定conversionを報酬へ投影

一つの出来事を各機能で複製しない。source referenceとprojectionでつなぐ。

### 5-3. 顧客通知と運用者通知

ユーザー判断どおり双方向を残す。ただし24内で定義を分離する。

- 顧客通知: customer recipient、取引/予約案内、顧客同意とLINE枠
- 運用者通知: operator recipient、対応/障害、勤務・担当・代替channel
- 共通にするのはdelivery ledger、retry、auditだけ
- 片方の定義をもう片方へ変更しない

### 5-4. 機能設定と緊急停止

- 31機能設定: 契約・会社・個人の通常設定
- 32運用状態: 障害時のserver kill switch
- 実行可否は`運用停止 > 契約不可 > 会社OFF > 個人非表示 > 定義停止`の順で判定
- 画面非表示だけでAPI実行を許可しない

### 5-5. テンプレート・共通情報・登録メディア

- 14: account共通値と個別override
- 15: media asset、private original、派生版、利用先
- 11: message/content version。mediaは15を参照
- templateやmessageへ画像URLをcopyして正本化しない
- secret・tokenを14へ置かない

### 5-6. 写真審査と登録メディア

- 22投稿写真は審査前のsubmission asset
- 採用・同意後のpublic derivativeだけ15のmedia assetとしてpromotion可能
- originalはprivateのまま
- 採用と公開は別状態
- AIは人の確認補助に限定

### 5-7. EC連携とNEN配信

- 23だけがEC Webhookを受信・正規化
- 21は23のdomain eventをtriggerとして使う
- 21が独自にEC eventを再受信しない
- 到着実測と予定を分ける
- coupon/point/LINEは各action executionでreconcile

### 5-8. オートメーションと各機能のアクション

2026-09-03: 本文で25を参照していなかった07・21・23・24・27に「アクション実行は25接続契約に従う」を明記した。接続契約のカタログ(15処理)が唯一の正本であり、機能別要件は処理名を再定義しない。

25の共通action catalogを、5、7、8、9、16、17、19、21、23、24、27、29が参照する。

- action definition/versionは不変
- 利用先はversion単位で表示
- 新版公開で利用先を自動変更しない
- domain固有処理はadapter。任意JSON実行を許可しない

### 5-9. 予約管理・予約設定・イベント予約

- 28がmenu/resource/calendar/exceptionの定義と版
- 27が個別予約、代理予約、競合、Google同期
- 29がevent capacity、seat、waitlist、promotion deadline
- 通常予約枠とevent定員を同じ在庫recordに無理に統合しない
- 共通にするのはcontact、notification、idempotency、audit、calendar adapter

### 5-10. ダッシュボード・分析・運用状態

- 1は20のaggregateと32のhealthを読む入口
- 1独自のKPI計算を作らない
- cardごとに期間、分母、鮮度、出典を表示
- 障害時に0へ置換しない

### 5-11. 友だちと友だち属性

- 3はfriend identity/profile/current value
- 4はattribute schema、tag/field/mark definition
- schema削除はvalueを物理削除せずarchive
- 値変更はactor/source/reasonのaudit eventを持つ

### 5-12. 配信5機能

5シナリオ、6一斉、7リマインダ、8自動応答、9友だち追加時配信は次を共有する。

- message content version
- audience/condition engine
- delivery ledger
- LINE quota/rate limit
- opt-out/block/feature/kill-switch gate
- test recipient
- click tracking
- skipped/retry/permanent failure

UIとtriggerは分けるが、送信基盤を複製しない。

## 6. API共通規則

- 認証済みoperatorとaccount contextをserverで解決
- permissionはdeny-by-default
- listはcursor pagination。最大件数を固定
- writeは`Idempotency-Key`と`expectedVersion`
- 競合は409、権限不足403、対象なし404、入力不備422
- 非同期処理は202＋job ID。完了を同期応答で装わない
- errorは利用者向けcodeと内部trace IDを分離
- secret/PIIは項目マスク、purpose、download audit
- bulkは全件transactionを装わず、対象ごとの結果を返す
- exportは非同期生成、短期署名URL、件数・条件・actorを監査
- delete endpointは原則archive。物理削除は保持policyのsystem jobだけ

## 7. V6デザインへの修正依頼の集約

機能別要件に散在していたPencil側の修正依頼をここへ集める。**設計を変えるときはPencilを先に直す**(`docs/v6-common-rules.md`)ため、実装前にこの一覧をPencilへ反映し、反映した項目に日付を付ける。各機能側の記述は残すが、正本はこの表である。

「反映」欄の書き方: 反映したら `YYYY-MM-DD`(Pencil で直し、設計画像を書き出した日)。まだなら `未反映(理由)`。一部だけ直したときは `一部反映(残りは何か)`。文言では確かめられないもの(色・並び・置き場・描画ずれ)は `未確認(理由)` と書き、絵を見て判断する人に渡す。

**欄の根拠は設計画像(`docs/design-reference/<機能>-v6/*.txt` と `*.png`)。コミットメッセージの「反映した」という宣言を根拠にしない。** 宣言と実際が食い違った例がある(台帳 kentavndng/line-harness-board#101)。担当は lane:pen、欄を埋めるのは司令塔(台帳 kentavndng/line-harness-board#18)。40 番の主ボタン色は索引 §5-2 で決定済み。

| # | 機能 | 画面 | 修正 | 出典 | 反映 |
|---:|---|---|---|---|---|
| 1 | 02 受信箱 | 全画面 | 「対応マーク」を「対応状況」へ。友だち属性の対応マークは右パネルの別項目として表示 | 02 §3、§19 | 2026-09-03 |
| 2 | 03 友だち | 一覧・詳細 | 「相手から／自分から」を「LINEでブロック／管理画面で非表示」へ | 03 §23 | 2026-09-03 |
| 3 | 03 友だち | 一覧・一括操作 | 「対応マーク」が固定の対応状況か自由マークかを画面上で分ける | 03 §23 | 2026-09-03 |
| 4 | 03 友だち | UID移行 | 「異なるプロバイダーはAPIで自動対応できない」を常設 | 03 §23 | 2026-09-03 |
| 5 | 03 友だち | 統合前確認 | 利用目的と同意・規約の確認欄を追加 | 03 §23 | 2026-09-03 |
| 6 | 03 友だち | CSV | CSV操作の専用画面またはUID移行内の別モードを追加 | 03 §23 | 2026-09-03 |
| 7 | 04 属性 | 4-1 | 上部に「対象アカウント範囲」を追加 | 04 §20 | 2026-09-03 |
| 8 | 04 属性 | 4-1-C | 保存先を「共通アクション・オートメーション」と明記 | 04 §20 | 2026-09-03 |
| 9 | 04 属性 | 4-1-F | 既定操作を「アーカイブ」に変更し、代替・使用版を表示 | 04 §20 | 2026-09-03 |
| 10 | 04 属性 | 4-1-H | 解析結果、重複、要修正、実行結果の状態を追加 | 04 §20 | 2026-09-03 |
| 11 | 04 属性 | 4-2-A | 画像・PDFは差し込み不可、メディア参照であることを表示 | 04 §20 | 2026-09-04 |
| 12 | 04 属性 | 4-2-B | 切戻し期限、変換不可の個別修正導線を追加 | 04 §20 | 2026-09-04 |
| 13 | 04 属性 | 4-3 | 「対応状況とは別の自由分類」と明記 | 04 §20 | 2026-09-04(4-3 と 4-3-A の両方に入れた) |
| 14 | 04 属性 | 4-3-B | 置換先を必須選択として追加 | 04 §20 | 2026-09-04(あわせて既定操作をアーカイブへ) |
| 15 | 04 属性 | 4-4 | 所有者、対象範囲、ライブ/固定、revisionを表示 | 04 §20 | 2026-09-04 |
| 16 | 04 属性 | 4-4-A | 「次回実行から変わる」はライブ参照時だけ表示 | 04 §20 | 2026-09-04 |
| 17 | 09 追加時配信 | 9-1-A/B/C/I | 設定は1枚・削除概念なし・本文はシナリオ側のため、4画面を削除または非表示タグ | `scripts/visual-qa/screens.mjs` gap:'drop' | **取り消し(2026-09-04)**。この依頼は誤り。根拠が実装の台帳(`gap:'drop'`)だけで、要件を見ていない。要件 09 §3 の画面表は `s9gAx` `W1wzCa` `K0Dbr2` `Q3qP1r` を V6 の 10 画面として名指しし、§4-1 は複数ルールと優先順位を、§4-2 は流入リンクの複数選択を求めている。設計が正本なので**4画面とも残す**。実装が1枚JSONなのは実装側の遅れ(要件 09 §2 が「V6の複数経路ルールを表せない」と書いている)。付けていた「V6では使わない・台帳から外す」の札は Pencil から外した |
| 18 | 10 ウェビナー | 10-1-K | 視聴履歴の物理削除を禁止するため削除確認を削除し「アーカイブ確認」へ | 同上 | 2026-09-04 |
| 19 | 13 回答フォーム | 13-1-B | デザイン設定は作らない方針のため削除 | 同上 | **取り消し(2026-09-04)**。この依頼は誤り。「作らない方針」の出どころは実装の覚え書きで、要件ではない。要件 13 §3-8 の画面表は `ava2n` を正本ルート `/form-submissions/edit?id={id}&tab=design` 付きで載せ、§3-4 がテーマ色5役割・ロゴ・角丸3段階まで決めている。設計が正本なので**残す**。札は Pencil から外した |
| 20 | 16 アフィリエイト | 16-1-G | 支払記録の物理削除を禁止するため削除確認を「アーカイブ確認」へ | 同上 | 2026-09-04 |
| 21 | 全機能 | 権限不足状態 | `forbidden`に対応する設計部品が無い。共通部品`ListState`の権限不足状態を1枚描く | `apps/web/src/components/shared/list-state.tsx` | 2026-09-04(共通部品「見る権限がありません」を作り、3-1-E を4状態にした) |
| 22 | 全機能 | 本文見出し | トップバーの画面名と本文H1の二重表示を禁止する規則を、設計画像側でも徹底 | `docs/v6-common-rules.md` §1-1 | 2026-09-04(設計画像で確認。ダッシュボード・友だち・受信箱とも二重表示なし) |
| 23 | 01 ダッシュボード | `NjK9q` | 「対応が必要な受信」カードの値が`5件表示`になっている(`vUXKb`は`5件`)。プルダウン文言の混入を直す | 01 §1 | 2026-09-04 |
| 24 | 01 ダッシュボード | `vUXKb` `NjK9q` | 「今日やること」右の並び順ラベルが「優先度順」と「優先度が高い順」で揺れている。1つに揃える | 01 §1 | 2026-09-04(設計画像で確認。5枚とも「優先度が高い順」) |
| 25 | 01 ダッシュボード | `vUXKb` `Alekb` `JN6mQ` `NjK9q` | 「接続状態」の有効友だちが398人と4人で画面ごとに違う。見本データを揃える | 01 §1 | 2026-09-04 |
| 26 | 01 ダッシュボード | `vUXKb` | 「今月の送信枠」の`197 / 200通`と「残り98.5%」が使用数か残りか読めない。「使用 197 / 上限 200通」の形にする | 01 §1、§14 | 2026-09-04 |
| 27 | 01 ダッシュボード | `NjK9q` | プルダウンの選択印が共通部品`Gfsb4`と違う | `docs/design-qa/dashboard-v6/design-qa.md` | 2026-09-04(単一選択なので✓印にした。`Gfsb4` は複数選択なのでチェックボックスのまま) |
| 28 | 33 アカウント設定 | 新規 | LINEアカウント一覧(L)、登録(E)、詳細・編集(D)、乗り換え・引き継ぎ(E)の4画面を追加 | 33 §5-2 | 2026-09-04(Pencil に 33-1〜33-4 を新設。台帳への登録は司令塔へ依頼) |
| 29 | 34 はじめの設定と案内 | 新規 | はじめの設定(B)、レシピ一覧(L)、レシピを複製する(E)、マニュアルの正本表(L・運営側)の4画面を追加 | 34 §5 | 2026-09-04(Pencil に 34-1〜34-4 を新設。台帳への登録は司令塔へ依頼) |

次の30〜50は、2026-09-03に`docs/design-reference/*-v6/`の設計画像84枚(7機能)を全枚確認して見つけた設計側の問題。優先度順。機能4と9〜32は設計画像が未書き出しのため未確認で、書き出し後に同じ基準で追記する。

| 30 | 05 / 06 / 03 | `kk8dz` `xfYLn` `XQfMD` `bV5Vs` `I6UAdr` `w8W4Eh` | 右390カラムと本文が1920を超える(`I6UAdr` `w8W4Eh`は1952幅)。本文の入れ物をfillにし、右カラムを390固定にする | 設計採点 2026-09-03 | 2026-09-03 |
| 31 | 01 / 02 / 05 | ダッシュボード5枚、受信箱17枚、`g2UNV` `M2b2B` | サイドメニュー`J33xq`の選択項目が画面と違う。画面ごとに選択状態を上書きする | 同上 | 2026-09-03 |
| 32 | 03 / 06 / 08 / 05 | `vtBCu` `u6gHt` `ivDoe` `Yj6CQ` `p97Tf` `vW4Es` `kk8dz` `bV5Vs` | 複製元の文言が残っている(UID移行のステッパーが一斉配信の段名、結果画面に「下書き保存」、自動応答のプレビュー帯が「購読開始から0日後」、チェック3項目の流用、「この条件を削除」の対象違い)。各画面の対象名に書き直す | 同上 | 2026-09-03 |
| 33 | 06 / 07 / 08 / 05 | `XQfMD` `J64xI` `ivDoe` `s6Vvp` `W98zZQ` `kk8dz` | 変数が`{{name}}` `{{meet_url}}` `{お名前}`の生表記。差し込みチップ1種に統一し、本文中も同じチップで描く | 同上 | 2026-09-03 |
| 34 | 01 / 05 / 06 / 07 / 08 / 03 | `vUXKb` `TC1b1` `q76C35` `TmHjF` `M1EXwB` `cmDfJ` `r7eSi` `YzxU1` `g2UNV` | 同一画面内で数値が矛盾する(5件と2行、197/200通と残り98.5%、9,110分前、フォルダ計19と9、ページ送り「2 [ ] [ ] 2」、件数とページ数、「全7ステップ」)。見本データを1セットに決めて全画面で使う | 同上 | 2026-09-03 |
| 35 | 06 / 07 / 08 | `q76C35` `M1EXwB` `cmDfJ` | 絞り込みチップ「予約中のみ」「有効のみ」が選択中なのに下書き・停止中が並ぶ。未選択に描くか、行を条件に合わせる | 同上 | 2026-09-03 |
| 36 | 02 / 01 | `YZaDK` `L35UOV` `NWbuF` `NjK9q` | 開いた状態の描き方が壊れている(プルダウンが2段に複製、フォルダ一覧がモーダルの背面、単一選択にチェックボックス、選んだ値がKPI見出しに漏れる)。プルダウンは元の欄の直下に1つだけ重ね、単一選択は✓印にする | 同上 | 2026-09-03 |
| 37 | 02 / 03 | `f0zn6` `H3lAOB` `w72a2` `ASsb3` `NfgOs` `ANgda` `TUveA` `Igi72` | 受信箱オーバーレイの重なり・はみ出し(バッジが並び順ラベルに被る、日時と文言の重なり、主ボタンがパネル外、区切り線がモーダル外、分類チップが1920でも「>」で切れる)。パネル幅に収め、分類チップは2段に折る | 同上 | 2026-09-04 |
| 38 | 全機能 | `bzDn6` `q5G45` `TmHjF` `dC0yg` `q8wSqO` | 失敗状態に再試行が無く、読込中・空でもKPIとページ送りが残る。`OLMp0`に「再読み込み」を足し、KPIは`—`、ページ送りは消す。「へ。」の孤立改行を直す | 同上 | 2026-09-03 |
| 39 | 06 / 07 / 02 | `zZ9fA` `uJP22` `vW4Es` `LHjwD` | 押せないボタンが通常表示(使えないテスト送信、枠不足でも「配信を予約」、重複エラー中の保存)。無効状態をボタン部品に足して当てる | 同上 | 2026-09-04 |
| 40 | 全機能 | 部品`nBRKk` `uzNEC` `rpot9` `ytG7l` | フォーカス表示が84枚のどこにも無い。4部品にフォーカス状態を描く。緑の補足数値は`$accent-deep`に寄せ、主ボタンの白文字 on `#06c755`(約2.3:1)は、白文字が乗る緑をすべて既存トークン`$accent-deep`(#087A3E)にする(決定済み、索引 §5-2)。文字が乗らない緑は触らない | 同上 | 2026-09-04 |
| 41 | 06 / 07 / 08 / 05 / 03 | `bPF0s` `PSmHo` `e6iJG` `s6Vvp` `kk8dz` `InCDe` `bV5Vs` `NrBkW` | 追従バーの規則違反(空のバー3枚、並びが機能で逆、右寄せ、同一画面で構成が変わる)。§1-6のとおり削除は左・他は中央に統一し、シナリオ編集に「配信を開始」を置く | 同上 | 2026-09-04 |
| 42 | 03 / 06 | `YzxU1` `r7eSi` `vtBCu` `I6UAdr` `u6gHt` | 主ボタン色が緑と青で分裂、タブ様式が2通り。緑1系統、タブは`ISA1Q`に統一 | 同上 | 2026-09-04 |
| 43 | 05 / 06 | `kk8dz` `xfYLn` `XQfMD` | メッセージ種別タブが6種・9種・9種(並びも違う)の3通り。1部品にする | 同上 | 2026-09-04(`XQfMD` は種別タブを持たず見出しだけなので触っていない) |
| 44 | 05 / 06 / 07 / 08 | `M2b2B` `u6gHt` `GC4St` `t7UtYQ` | CSV書き出しの置き場が3通り(緑主ボタン、追従バー、右上)。「すでにあるものを扱う」は右上の副次ボタンに統一 | 同上 | 2026-09-04 |
| 45 | 05 / 06 | `M2b2B` `u6gHt` `vW4Es` | 結果画面の数値が入力欄の見た目。`XywGr`の数値カードにし、結果画面から「テスト送信」「配信イメージ」を外す | 同上 | 2026-09-04 |
| 46 | 05 / 06 / 07 / 08 | `TC1b1` `q76C35` `M1EXwB` `cmDfJ` | 一覧の行操作が削除だけ。「結果を見る」「複製」を行に足す(読み上げ名に対象名)。シナリオ一覧から結果`M2b2B`への入口を作る | 同上 | 2026-09-04(共通部品「一覧行の操作メニュー」を作り、開いた状態を部品カタログに置いた。読み上げ名は行の対象名にした) |
| 47 | 03 | `PhxG6` | 対応チップと文字の二重表示で矛盾(対応済み＋対応中)、`[sticker]`の露出、UID移行タブと右上ボタンの重複。状態は1表現、内部語は「スタンプ」に | 同上 | 2026-09-04 |
| 48 | 全機能 | 各画面 | 表記ゆれ・内部語(未割当/未割り当て、対応済/対応済み、dry-run、SlackのPRスレッド、Webhook同一ID、Flex、AND/OR、外部サービス、ブレイクダウン/マトリックス、9,110分前は「6日前」)。共通ルールの用語表に載せて全文検索で潰す | 同上 | 2026-09-04(`docs/v6-common-rules.md` §2-7 に用語表を足した。あわせて設計に残っていた `未割当`(32回/16枚)を `未割り当て` へ、`M2b2B` の `直近30日` を `この30日` へ。数え直して両方0件。意味が変わる4語は「そろえない語」として理由つきで残した) |
| 49 | 07 / 08 | `s7T2dz` `K7vg2` `g46ja` `U9hzqH` | ウィザードの段とボタン名のずれ(「予定を確認」が次工程名と違う、「自動応答ルールを保存」、テスト画面のステッパーがSTEP5)。「{次工程名}へ」に揃え、テストはSTEP4内の位置で描く | 同上 | 2026-09-04 |
| 50 | 07 / 05 / 03 / 02 / 08 | `J64xI` `bV5Vs` `I6UAdr` `xGLVe` `PSmHo` `e6iJG` | 小さな描画ずれ(本文4行目がtextareaの外、4行目の行操作アイコン、カード外のボタン、ヘッダの担当と右パネルの矛盾、「一時停止」の「?」アイコン) | 同上 | 2026-09-04(はみ出しは0件。`xGLVe` のヘッダと右パネルの担当の食い違いを直した) |

Pencilの画面数は、17〜20と28〜29を反映すると260から変わる。反映後に`docs/v6-canonical-design-decision.md`の実測値を更新する。

## 8. 共通監査

次を追記で残す。

- actor、role、organization/account
- action、target type/ID
- before/afterの安全な差分
- reason、approval、request/trace ID
- version、idempotency key
- occurred/recorded time、timezone
- external provider reference

secret、本文PII、URL query、画像original等を監査logへ直接書かない。high-risk操作は再認証、必要に応じ二者承認を使う。

## 9. 100点へ近づける共通条件

全機能に次がそろった時だけ98〜100点とする。

- 主タスクを開始・完了できる
- 空、読込、error、権限、失敗、競合がある
- account境界とserver権限testが通る
- 公開版と待機snapshotが再現できる
- external副作用が冪等でreconcileできる
- 取得不能を正直に表示する
- archive・監査・保持がある
- migrationの件数・金額・hashが一致する
- 1440/1920で横scrollがない
- 設計との画像比較は共通工程ゲート(共通基盤要件 §10)で担保する。要件の完了条件には含めない
- `準備中`または無効な見せかけbuttonがない

## 10. 残る外部判断

要件を止めないが、実装前に契約・値を決めるもの:

- 動画providerとtranscode/CDN契約
- 広告platformごとのscope、API version、費用取込
- EC provider/shopとconnector権限
- 決済provider、返金、webhook
- Google Calendarの対象calendarと競合優先
- affiliateの税・源泉・支払format
- 写真AI provider、保持、同意文面
- operator通知の代替channelと勤務時間

未決定値はfeature flagで閉じ、画面へ使えない操作を出さない。
