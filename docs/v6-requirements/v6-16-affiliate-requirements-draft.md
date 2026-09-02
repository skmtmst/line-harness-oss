# V6 16 成果・アフィリエイト 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 16-x、現行affiliate/link/offer/attribution/conversion、承認・支払い

## 0. 結論と採点

V6は、紹介者、案件、リンク、流入、成果、承認、報酬、締め、支払明細を一つの業務として設計している。Lステップの流入・コンバージョンを超え、ASP/紹介制度まで扱う独自機能である。画面の業務説明も分かりやすく、要件定義へ進める。

現行には紹介者、ランダムcode、友だち連携、複数link、90日last-touch、自己紹介除外、案件、固定報酬、conversion snapshot、pending/approved/rejected、重複候補、reportがある。一方、`affiliates`自体にLINEアカウント列がなく、管理APIも全件を返す。支払い条件はメモ項目だけで、締め・支払台帳・銀行口座・調整・PDF/CSVは未実装。V6を今の集計値だけで作ると、お金の確定履歴を後から再現できない。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 99 | 100 | 紹介から支払いまで運用者の言葉で通る |
| Lステップ対抗力 | 100 | 100 | 流入・CVに支払業務まで統合する独自優位 |
| 現行実装完成度 | 64 | 99 | 計測・案件はあるがsettlementがほぼ未実装 |
| データ安全性 | 32 | 100 | tenant境界と金額snapshot/台帳がP0 |
| 実現可能性 | 96 | 99 | 銀行振込自体を除外すれば実装可能 |
| 要件確定度 | 97 | 100 | 会計・税務判断を外部確認事項として分離 |

不可能・除外は、この画面から銀行振込を実行すること、成果の絶対的な不正判定、cookie/LINEを越えた完全な人物追跡、名前だけの自動名寄せ、承認・締め済み金額の直接書換え、紹介者削除と同時に過去の支払いを消すこと、税・源泉徴収を法務確認なしに自動確定することである。

## 1. V6実Node

| Node ID | 画面 |
|---|---|
| `PouPn` | 紹介者一覧・funnel |
| `GH8VL` | 案件 |
| `n5VVTb` | 成果承認 |
| `njLGA` | 支払い |
| `xqT1Z` | 紹介者登録 |
| `jwrbf` | 紹介者の成果内訳 |
| `GPWzq` | 案件作成 |
| `QX70l` | 削除/停止確認 |
| `GqFTV` | 支払確定 |

7画面は1920×1136、2画面は1920×1080。Pencilのテキスト・構造を確認した。画像出力ノイズのためピクセル比較は未完。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

V6削除dialogには「支払いの記録も一緒に消える」選択肢があるが、正式要件では禁止する。「紹介を止める」「個人情報を匿名化する」「管理一覧からarchive」のみ許可する。

## 2. Lステップとの差

Lステップ公式は[コンバージョン管理](https://linestep.jp/lp/01/features39.html)で外部成果の検知とaction、公式紹介資料では流入・成果分析を案内している。紹介者への案件公開、承認、保留、締め、支払台帳は通常のLステップ中核とは別用途である。

V6が上回る条件:

- 18流入、19conversionと同じeventから報酬を一回だけ作る
- 紹介条件・報酬をversion snapshotし、後編集で過去金額を変えない
- pending→approved→held→payable→settled→paidを追記台帳で追う
- 紹介者本人がlink、成果、支払予定、明細を安全に確認
- 重複・自己紹介・停止後・異常速度を理由付きでreview

## 3. 用語と主タスク

- 紹介者: affiliate
- 案件: offer/campaign
- 紹介link: link。紹介者×案件×掲載場所
- attribution: どのlinkを成果に結びつけるか
- 成果: 19conversion event
- 報酬: 成果承認時に発生するledger entry
- 締め: 対象ledgerをsettlementへ固定
- 支払確定: 銀行振込用fileへ含める金額を固定
- 支払済み: 外部銀行で実行した結果を記録

管理者は案件を公開し、紹介者へlinkを発行し、成果の疑いを確認し、期限後に報酬を確定し、締めて振込用fileと明細を作り、実際の振込結果を登録する。

## 4. アカウント境界

現行`affiliates`は全体共通であり、管理APIもaccount filterを持たない。P0で次へ移行する。

- affiliate、offer、link、conversion、reward、settlement、bank profileに`organization_id`と`line_account_id`
- APIはaccount必須、本人のscopeをserver検証
- friend連携は同一accountだけ
- offerが参照するconversion point、tag、scenario、mileage、actionも同一account
- codeはaccount namespace内unique。公開linkはguess困難なref code
- 組織横断紹介制度は別entitlementと明示的scopeでのみ許可

## 5. attribution

既定は既存の90日last-touchを使うが、案件versionごとにsnapshotする。

- window: 1〜365日、既定30日。既存90日はlegacyとして表示
- model: last eligible touch。first-touch等は初期除外
- friend追加時の紹介者と成果時の紹介者を分けて保持
- 自己紹介、停止link、停止紹介者、期限外、別accountを除外
- 同一人物推定は電話hash/email hash/EC顧客ID等の確かなidentityだけ
- `attribution_decision`へ候補touch、選択理由、versionを保存
- conversion発生後にlink/offerを編集してもattributionを再計算しない
- 管理者の再帰属は理由必須のadjustmentで、元記録を残す

## 6. 案件と報酬

案件は公開versionを持つ。

- 成果地点
- 対象期間、紹介window、同一identityの回数制限
- 自動承認可否と上限金額
- 固定額、または売上率。初期はJPYのみ
- 率報酬の基準: 税込/税抜、送料・割引・返金の扱い
- 1件上限、月上限、最低支払額
- hold days
- 紹介された友だちへの25共通action
- 紹介者本人への24通知と17mileage

報酬額はconversion時または承認時の案件versionと売上snapshotから計算し、`reward_calculation`へ式・入力・丸め・currencyを保存する。案件の金額変更で過去分を変えない。

## 7. 成果承認

状態:

```text
detected → pending_review → approved → held → payable → settled → paid
                      └→ rejected
approved/settled後の取消 → adjustment（次回相殺または追加支払）
```

- pending/rejected/approvedを直接上書きせず、decision eventを追記
- 一括承認はproblem flagなしだけが既定
- flag: duplicate_candidate、self_referral、too_fast、inactive_affiliate、out_of_window、value_mismatch、refund_pending
- flagは疑いであり自動却下しない
- 自動承認は低額・回数上限・flagなし・案件version許可時のみ
- 承認の副作用はidempotent。tag/mileage/scenario失敗でも承認金額を失わずretry
- 却下理由を紹介者へ見せるかは分類別設定

## 8. 支払台帳

新規に追記型台帳を作る。

- `affiliate_reward_entries`: credit/debit、conversion、offer version、amount、status
- `affiliate_adjustments`: refund、取消、手動訂正、理由、元entry
- `affiliate_settlements`: 締め期間、timezone、currency、version、total、state
- `affiliate_settlement_lines`: affiliate、entry、amount snapshot
- `affiliate_payout_batches`: bank file、checksum、creator、approved_at
- `affiliate_payout_results`: paid/failed/returned、external reference、日時
- `affiliate_statements`: PDF metadata、version、期限

締めはtransactionで未settled payable entryを固定する。同じentryを二つのsettlementへ入れない。締め後の却下・返金は元額を書換えず次回のnegative adjustmentにする。

「この人だけ確定」と全体締めを混同しない。個別確定は同じ締め期間のpartial settlementとして監査するか、原則全体締め後の支払batch選択にする。推奨は後者。

## 9. 銀行口座・明細・CSV

- 口座は紹介者本人の認証済み画面で入力
- 暗号化保存、管理画面は銀行名・支店・種別・末尾4桁・名義だけ
- 全口座番号は通常APIで再表示しない
- 変更は本人再認証、旧値は監査用暗号snapshotまたは不可逆fingerprint
- 支払担当だけがbank exportでき、MFAと再認証を要求
- CSVは銀行format別schema、encoding、文字長、金額、名義を検証
- export fileは短期保持、署名URL、download audit
- PDF明細はsettlement snapshotから再生成可能
- このシステムは振込を実行せず、CSV出力と結果取込まで

税・源泉徴収・インボイスの計算は、対象事業者・契約・法域の確認後に別要件化する。初期版は税額入力/調整項目と明細表示だけにし、法的判定を自動化しない。

## 10. 紹介者の停止・archive

- `active → paused → archived`
- pauseで新規link accessと新規attributionを停止
- 過去成果、承認、支払、明細は保持
- 未払・pendingがあればarchive前に件数と対応先を表示
- 友だち連携解除とaffiliate停止は別操作
- GDPR/個人情報削除等は識別情報を匿名化し、金額・監査の法定保持を別管理
- 物理削除は一般UIから不可

## 11. API

- affiliates list/detail/create/update/pause/archive
- offers definitions/versions/publish/pause
- links create/pause/replace/QR
- attribution journeys
- conversions review list/decision/bulk decision
- settlements preview/close/reopen禁止/adjust
- payout batches create/export/result import
- statements generate/download
- self portal profile/bank/link/result/statement

すべてaccount scope、permission、expected version、idempotency keyを持つ。金額確定、CSV、口座変更、承認、却下、調整は監査必須。

## 12. 権限

- 閲覧: affiliate.view。ただし報酬・口座は項目マスク
- 紹介者/案件編集: affiliate.manage
- 成果承認: affiliate.approve
- 締め・調整: affiliate.settle
- bank export/支払結果: affiliate.payout＋MFA
- CSV: affiliate.export
- 紹介者本人: 自分のaccount/affiliateだけ

同じ人が成果を作り、承認し、支払確定する場合は警告。高額batchは二者承認を設定可能にする。

## 13. 状態

- 空、読込、error、権限不足
- 紹介者active/paused/archived、友だち未連携
- link有効/停止/案件未設定/期限切れ
- 案件draft/published/paused/ended
- 成果pending/flagged/approved/rejected/held/payable
- settlement preview/closed/exported/paid/partial/failed/returned
- bank profile missing/verification required
- CSV生成中/失敗/期限切れ
- 競合409、一括操作の一部対象外

## 14. 既存移行

1. affiliates、links、offers、conversion attributionをaccount別に棚卸し
2. accountを一意に決められない紹介者は隔離し、自動割当しない
3. offerをversion 1へsnapshot
4. approved conversionから初期reward ledgerを生成し、現行reportと件数・金額照合
5. pending/rejectedはdecision historyをlegacy source付きで生成
6. payout historyが現行にないため、推測でpaidを作らない
7. 運用者が開始残高・既払額を証憑付きでimport
8. dual-read比較後に新ledgerを正本化

## 15. 除外

- この画面から銀行振込実行
- 完全なfraud自動判定
- 名前だけの自動名寄せ
- first/linear attributionの初期実装
- 過去報酬の案件編集による再計算
- 承認・締め済み金額の直接更新
- 紹介者削除による履歴消去
- 法務確認なしの税・源泉自動判定
- 口座番号の通常再表示

## 16. 完了条件

- V6 9画面の主操作・状態・遷移が動く
- account境界を全API/DB queryで保証
- クリック→追加→成果→承認→保留→締め→支払を一意に追える
- 金額・案件・attributionがversion snapshotされる
- 重複再試行で二重成果・二重報酬・二重締めがない
- 口座暗号化、項目マスク、MFA、download audit
- 締め後取消はadjustmentになり履歴を消さない
- 紹介者停止後も履歴・明細を再現
- 銀行CSVを検証し、実振込はしないと明示
- 1440/1920で横スクロールなし
- V6実Nodeと同幅画像比較を添付

## 17. 実装順

1. tenant境界と物理削除停止
2. offer/reward snapshotとappend-only ledger
3. approval decisionとflag
4. settlement/adjustment
5. bank profile暗号化とself portal
6. CSV/PDFと支払結果
7. V6各画面、権限、二者承認
8. legacy金額照合、E2E、security、画像比較

## 18. 実装進捗（2026-08-28）

状態: **一部実装**。9画面すべての完了ではない。

- 完了: 紹介者・紹介リンクを停止すると、停止後のリンク表示・クリック・新規成果帰属を止める
- 完了: 一般APIからの紹介者物理削除を405で停止し、過去の成果・支払い記録を保持
- 完了: 紹介者一覧をV6実Node `PouPn`へ接続し、空・読込・失敗を共通状態部品へ接続
- 完了: 本文の重複タイトル・説明・準備中マニュアルを削除
- 未完了: 紹介者のアカウント境界、案件版、報酬台帳、締め、支払、口座、CSV/PDF、二者承認
- 未完了: 支払い `njLGA`、登録 `xqT1Z`、成果内訳 `jwrbf`、案件作成 `GPWzq`、停止確認 `QX70l`、支払確定 `GqFTV` のV6接続
- 画像確認: Claude側Visual QAへ引き渡し、1440px・1920pxの設計比較は未確認
