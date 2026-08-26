# V6 22 写真審査 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 22-x、現行写真投稿・審査・ポイント・公開ギャラリー

## 0. 結論と採点

V6は、投稿写真を一覧・一枚表示で確認し、理由付き差戻し、採用、ポイント付与、公開先管理まで一つの作業にしている。Lステップの登録メディアやフォームでは代替しにくいNEN独自機能で、業務UIは競合より強い。

ただし、V6の「3回以上通した人は自動で公開」は除外する。AIや過去実績は確認順の最適化にだけ使い、公開の最終判断は人が行う。現行実装は写真・友だち・公開APIのアカウント境界、公開同意、原本保護、画像検査、ポイント付与の分散失敗が未対策である。さらにLIFF会員APIの採用写真queryにfriend条件がなく、他会員の採用写真を返し得る。最優先で閉じる。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 96 | 100 | 一覧→一枚→理由→公開先が自然。自動公開だけ修正 |
| Lステップ対抗力 | 100 | 100 | 投稿審査・報酬・公開管理を一体化する独自優位 |
| 現行実装完成度 | 52 | 99 | 投稿・採否・5pt付与はあるが審査業務と公開管理が不足 |
| データ安全性 | 24 | 100 | scope欠落、公開同意、原本公開、分散失敗がP0 |
| 実現可能性 | 97 | 100 | 画像処理・queue・同意・台帳の追加で可能 |
| 要件確定度 | 98 | 100 | 人の最終判断、公開同意、ポイント規則を固定 |

不可能・除外は、人の最終判断なしの自動公開、顔から人物を特定すること、AI判定の正確性保証、無断で氏名・顔・位置情報を公開すること、審査結果と外部ポイントを一つのDB transactionとみなすこと、採用後に履歴を消して取消すことである。

## 1. V6実Node

| Node ID | 画面 |
|---|---|
| `Qu6Vk` | 写真審査一覧 |
| `hHrz8` | 写真を1枚ずつ見る |
| `N2J629` | 写真を戻す理由をえらぶ |
| `J3Wxl8` | 出しているもの・公開先 |

全4画面は1920×1080。Pencilのテキスト・構造を確認した。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

V6の自動審査欄は次の表現へ修正対象として記録する。

- 「3回以上通した人は自動公開」→「確認順を後ろへ。公開は人が決める」
- 顔・ぼけ・他社ロゴ・重複はAIの注意候補。断定しない
- 暗い・壊れた画像の自動差戻しは、技術検査が確実な場合だけ。再投稿手段を必ず出す

## 2. Lステップとの差

Lステップの回答フォーム、登録メディア、タグ、シナリオを組み合わせれば写真受付と返信はできるが、写真ごとの審査、同意、派生画像、公開先、ポイント付与を一つの台帳で扱う用途ではない。

V6が上回る条件:

- 投稿→安全検査→人の審査→採用→ポイント→公開を一意に追う
- 差戻し理由と実際に送るLINE文面を同時確認
- 公開同意と氏名表示同意を別に持つ
- 原本を非公開にし、公開用派生画像だけを配る
- 公開撤回を全利用先へ即時反映し、履歴は残す
- AIは補助に限定し、判断根拠・model version・confidenceを記録

## 3. 主タスクと状態

運用者の主タスクは、同一LINEアカウントへ届いた未審査写真を安全に確認し、採用または理由付き差戻しを決め、採用時はポイントを一度だけ付与し、同意の範囲内で公開することである。

```text
uploaded → processing → pending_review
                    ├→ risk_review
                    ├→ technical_return → resubmitted
                    ├→ approved_private → published
                    └→ rejected
published → withdrawn → archived
```

- `rejected`: 内容上の不採用。理由必須
- `technical_return`: ファイル破損、形式・寸法不足等。利用者に不利益な審査回数へ数えない
- `approved_private`: 採用済みだが公開同意なし、または公開前
- `published`: 明示同意の範囲で公開中
- 採否と公開可否は別状態。採用しただけで公開しない
- 状態変更はdecision eventを追記し、現在値はprojectionにする

## 4. 投稿・画像安全

受信時に次を行う。

- 同じaccountのfriend/petをserverで検証
- 実byte数、magic bytes、画像decode、MIME、拡張子、pixel寸法を照合
- 許可形式・最大容量・最大pixel・animation有無を明示
- malware/危険file scan。失敗時は審査へ流さない
- EXIF/GPS等metadataを公開用派生画像から除去
- originalはprivate object key。通常APIから公開URLを返さない
- thumbnail、review、publicの派生画像をversion付きで生成
- hashで完全重複候補を出す。似た画像判定は注意候補だけ
- 画像処理jobの成功・retry・永久失敗を台帳化

現行はJPEG data URLと拡張子中心で受け、originalの`image_url`を保存・公開している。画像の実体検査、寸法、EXIF除去、private originalへの移行が必要である。

## 5. AI補助と人の判断

AI補助で許可するもの:

- 顔らしき領域、ぼけ、暗さ、他社logoらしきもの、重複らしさの注意表示
- 技術的に読めない画像の自動差戻し候補
- 低riskを後ろ、高riskを先へ並べる優先度
- 差戻し理由の下書き。送信前に人が確認

許可しないもの:

- AIだけで公開・不採用を確定
- 顔照合、本人特定、年齢・属性の推定
- 著作権・肖像権侵害がないとの保証
- confidenceを合否確率として表示

`photo_risk_assessment`にはmodel/provider/version、検査日時、flag、confidence、根拠領域、失敗を保存する。再評価で旧結果を上書きしない。

## 6. 審査操作

- 一覧は未審査、採用、差戻し、公開中を分け、account scopeの件数を表示
- 一枚表示はoriginal相当のreview derivative、投稿者、pet、投稿日時、過去採否、同意、risk flagを表示
- 採用、差戻し、cropして採用、rotate、original downloadを権限分離
- crop/rotateは派生assetを新versionで作り、originalを変えない
- 差戻し理由は定型＋自由記述。利用者向け文面をpreview
- 「次回は人が確認」は自動公開がないため不要。代わりに`要注意投稿者`の内部flagを期限付きで設定
- 一括採用は人が選んだ低risk写真だけ。件数・ポイント総数・公開範囲を確認
- 競合時は409。既に他者が審査した写真を上書きしない

## 7. 同意・公開・撤回

同意を分ける。

- 投稿・審査への同意
- 採用連絡・ポイント付与への同意
- 公開ギャラリーへの同意
- 広告・SNS・LP等への二次利用同意
- 飼い主名表示の同意。既定は非表示

`consent_record`に表示した文面version、scope、同意日時、取得経路、撤回日時を持つ。顔・未成年・第三者・位置情報・他社logoの疑いは人が追加確認する。pet名も公開範囲を選べる。

公開は`photo_publication`と`publication_placement`で管理する。公開URLは派生assetの署名/配信IDを参照し、original keyを出さない。撤回は新規表示を止め、CDN/cacheと登録利用先を期限内に失効させる。審査・同意・ポイント履歴は保持期間中残す。

## 8. ポイント付与

V6は100pt、現行定数は5ptである。既存採用を100ptへ黙って再計算しない。

- `photo_reward_policy`をversion化し、適用開始日時とpoint数を持つ
- 投稿受付時または採用時に適用policy versionをsnapshot。推奨は採用時
- 同一submission×reward typeで一回だけ
- 採用decisionはDBへ確定し、point付与はoutboxから外部ECへ送る
- 外部成功/DB失敗をprovider award keyで照合し、reconciliationする
- point失敗でも採用を失敗扱いに戻さず「採用・ポイント要対応」と表示
- 採用取消は元entryを書換えず、理由付きadjustment。公開撤回だけならポイントを自動減算しない

現行は外部ECへ先に5ptを付与し、その後DBを更新するため、EC成功・DB失敗で不整合になり得る。outbox/sagaへ移行する。

## 9. アカウント境界・権限

現行の管理写真一覧・個別取得・公開galleryには十分なaccount条件がない。全queryを修正する。

- submission、pet、friend、asset、decision、reward、publicationはorganization/accountを保持
- friend/petが同じaccountであることをwrite時に検証
- 管理一覧・件数・CSV・画像downloadはaccount scope必須
- 公開galleryは公開先に紐づくaccount/brandだけ
- LIFF会員APIの写真queryは必ず`ps.friend_id = currentFriend.id`を条件にする
- 同じLINE userが複数accountに存在する場合はLIFF/account contextで一意に解決

権限:

- photo.view、photo.review、photo.bulk_review
- photo.download_original（再認証・監査）
- photo.publish、photo.withdraw
- photo.reward、photo.export
- PII/同意は項目マスク。公開・一括・original downloadは監査必須

## 10. API

- submissions list/detail/upload-complete
- assets/process/status/derivatives
- assessments/re-evaluate
- decisions approve/return/reject/bulk
- reward status/retry/reconcile
- publications preview/publish/withdraw/placements
- consent list/record/withdraw
- public gallery scoped list
- metrics views/placements/export

すべてaccount scope、permission、expected version、idempotency keyを持つ。画像downloadは短時間署名URLにし、監査する。

## 11. 状態と画面要件

- empty/loading/error/permission/feature off
- processing/technical failure/risk review/pending
- approved private/publish pending/published/withdrawn
- point pending/synced/retry/permanent failed
- consent missing/partial/withdrawn
- derivative processing/failed
- concurrent review conflict
- bulk一部対象外
- public asset cache invalidation中/完了/失敗

V6の「出しているもの」の表示回数は、placementごとの実測eventまたは配信logから算出する。取得できない利用先は`未取得`とし、0にしない。

## 12. 既存移行

1. 全submissionをfriend/petのaccountへ割当。曖昧なものは隔離
2. LIFFと公開APIのscope欠落を先に修正し、security test
3. originalの公開URL利用先を棚卸しし、private original＋派生assetへcopy
4. EXIF除去済みpublic derivativeを再生成
5. pending/adopted/rejectedを新状態へmappingし、legacy decision eventを作る
6. 既存5pt採用はpolicy `legacy-5`として固定。再付与しない
7. EC point ledgerとsubmissionをaward keyで照合し、不一致を要対応へ
8. 明示的公開同意のないadopted写真は`approved_private`に置き、公開停止
9. dual-readと件数・画像hash・point総数を照合後に切替

## 13. 除外

- 人の最終判断なしの自動公開・自動不採用
- 顔認識・本人特定・属性推定
- AIによる権利侵害なしの保証
- originalの常時公開URL
- 同意なしの氏名・顔・位置情報・二次利用
- 採用取消で履歴を物理削除
- 公開撤回とポイント取消の自動連動
- 既存5ptの黙った100pt再計算
- 外部ECとDBを単一transaction扱い

## 14. 完了条件

- V6 4画面の主操作・状態・遷移が動く
- 管理・LIFF・公開APIのaccount/friend境界testが通る
- original非公開、EXIF除去、形式・寸法・decode検査が通る
- AIだけで採否・公開されない
- 差戻し理由とLINE文面を確認して送れる
- 採用と公開同意が分離され、撤回が全利用先へ反映
- point二重付与がなく、EC/DB不一致をreconcileできる
- legacy 5ptと新版policyが再現可能
- crop/rotateでoriginalが変わらない
- 1440/1920で横スクロールなし
- V6実Nodeと同幅画像比較を添付

## 15. 実装順

1. LIFF・管理・公開APIのscope欠落を修正
2. private original、画像検査、派生asset
3. 状態機械と追記decision
4. 同意・publication・撤回
5. reward policy、outbox、reconciliation
6. AI補助と人のreview UI
7. 既存移行、E2E、security、画像比較
