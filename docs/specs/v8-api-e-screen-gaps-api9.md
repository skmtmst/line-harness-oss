# E-4・E-7・E-8・E-9・E-10のAPI接続（API-9）

- 依頼：2026-10-07 司令塔Claudeの追加15項目。枝は `codex/kenta-v8-api-9`。コミットまで。
- 取り込んだ本線：`bb3e907abc6b3f4a698facce5ff720355e9513bb`。画面・docs/brain・要件の正本は変更しない。
- migration `605_restaurant_screen_api_additions.sql` は未適用の草稿。作成前に本線と公開PRの追加ファイルを確認し、手元の604に続く未使用番号605を採用。番号別承認・適用・push・PR・配備は司令塔へ引き継ぐ。

| 項目 | 変更した口と画面の接続 |
|---|---|
| 1 | POST `/api/restaurant-test/closures/preview` に `excludeId`。自店の有効な記録だけ除外できる。編集窓は対象のIDを渡す |
| 2 | GET `/api/restaurant-test/closures/:id/contact-status`。`contactedCount` と予約ごとの `contacted`。previewにも同じ項目。閲覧のみの人はGETを使う |
| 3 | 休業のPOST/PATCHに `notifyMedia`（省略時true）。falseでは新しい媒体の閉鎖作業を作らない。以前の閉鎖作業は再開へ移す |
| 4 | preview・連絡状況の予約に `customerPhone`（null可）、`friendId`、`isLineFriend`。フォロー中の自店の友だちだけLINE連絡可能 |
| 5 | 重複409は `{success:false,error:日本語,code:'closure_overlap',data:{conflicts,…}}`。`conflicts`に `name`・開始/終了日・時刻。画面は `ApiError.data.conflicts` を使う。予約登録のclosure_conflictもdataにclosuresを返す |
| 6 | GET `/api/hq/broadcasts/:id` の `data.input` から本文・対象・日時を復元。PATCH同口に作成入力全体＋ `expectedVersion`。`requestId`とIDは維持。送信後・古い版は409 |
| 7 | 統括の取得結果の `targets[].failureReasons` は `code,label,count,retryable`。応答なし・混雑・接続不良・共通情報不足・停止・送信前の停止など。送る前の人数0は `blockedReasons` に「友だちが0人です」。送信終了後の人数0はno_friends |
| 8 | 統括の作成・変更に `coupon / rich_message` など、店側と同じ本文種類・ `messageBubblesJson`。API-6と同じ共有素材変換と既存配信処理へ渡す |
| 9 | GET/PUT `/api/restaurant-test/close-notification-settings?account_id=…`。PUTは `storeId,notifyReopen,recipientMode,membershipIds,expectedVersion`。初期版0。recipientModeは `responsible / manager / selected`。選択IDは店舗の担当者一覧の **membership ID** |
| 10 | 電話は `{{var.store_phone}}`、予約URLは `{{var.reservation_url}}`。`{店の電話番号}` / `{予約ページ}` も受ける。未設定・空欄はプレビューでは値を差し込まず、送信前確認と予約送信時の共通情報確定で止める |
| 11 | POST `/api/liff/visit-stamps/redemptions/:id/use?accountId=…` は `{pin:'4桁'}` だけ。staffId入力を廃止。`data.staffId,staffName` を返す |
| 12 | POST `/api/liff/visit-stamps/cards/:id/paper-photos?accountId=…` はmultipartの `file`。JPEG/PNG/WebP、内容の識別子を検査、5MBまで。返ったphotoUrlを既存の紙移行申請へ渡す。GET同カードの `paper-requests` は本人の確認待ち・承認・却下と理由。写真表示は認証してBlobとして読む |
| 13 | GET `/api/visit-stamps/entries`：`accountId`必須、`from,to,friendId,kind,page,pageSize`任意。items/total/page/pageSize。期間は開始以上・終了未満、pageは1から、pageSize既定50・最大200 |
| 14 | カードsettingsに `slotCount`、倍率の `name,active`、`stackingOrder`、`maxStackedStamps`。画面はマス数と特典ごとの必要個数を別々に設定する |
| 15 | 機能設定 `visit_stamps` を追加（bookingの依存なし）。管理API・LIFF・自動押印で専用キーを確認。共有のスタッフ権限一覧は既に末尾のvisit_stampsで、順序は変えない |

## 連絡済みの数え方

対象は現在の休業と日時・卓が重なる有効な予約。休業の**作成時刻より後**に、その予約のフォロー中の友だちへ担当者が送信成功した記録があれば連絡済みとする。記録は `messages_log` の `direction=outgoing,source=manual,sent_by_staff_idあり` を使う。自動配信・受信・作成前の送信・送信失敗は数えない。同じ予約への複数送信は1件、同じ人に予約が2件あれば予約ごとに数える。

LINE本文が休業の案内かどうかまでは判定しない。時刻にタイムゾーンのない既存の送信記録は日本時間としてUTCに直して比べる。休業の変更後も作成時刻を起点にする。連絡は既存の1対1受信箱から担当者が行い、manualヘッダーを付ける。

## 再開通知と宛先

notifyReopen=falseでも、管理画面の媒体作業は「もう開けてよい」に移る。LINEの再開通知だけ停止する。閉鎖通知の入り切りは既存notifyで扱う。responsibleは当日の責任者、いなければ店長。managerは店長、selectedは選択した有効な自店の担当者。送信直前に現在の宛先設定を再確認し、変更前の宛先への未送信分を送らない。LINEがつながっていない担当者は管理画面から確認する。自動通知にはmanualヘッダーを付けない。

## PIN・写真・記録

PINは自店の有効かつ編集可能な店員から照合する。所属外・退職・閲覧のみは除外。同じ店のPIN重複を設定時に拒み、同時更新等で曖昧になった場合も任意の店員を選ばず拒む。スタッフごとの既存ロックに加え、PINだけの試行にも店舗全体の5回失敗・15分ロックを設ける。特典は使用時に必要個数だけ減らす。

紙の写真はprivateのR2キーへ保存し、公開の `/images/*` からは読めない。LIFFのGET `/api/liff/visit-stamps/paper-photos/:id` は本人だけ。管理のGET `/api/visit-stamps/paper-photos/:id` は担当店舗の権限を確認。本人がアップロードした写真だけ申請できる。同じ統合会員でも他店・別の友だちIDの写真と申請は公開しない。保存期限台帳に新しい表とR2キーも追加した。

店全体の記録のkindは `visit / manual / paper / redeem / reverse / expire / restore`。共通カードでも、実際に押した・使った店舗の記録だけ返す。

## 倍率と二つの上限

順序は `bonus_then_multipliers`（既定：初回ボーナスを足してから倍率）／ `multipliers_then_bonus`（倍率後に初回ボーナス）。期間・曜日・時間の倍率は配列順、ランクは該当する有効な倍率の最大値。active=falseの倍率は使わない。

maxStackedStampsを設定した場合、maxPerVisitは倍率前の1回の上限、maxStackedStampsは倍率とボーナスを重ねた後の上限。maxStackedStamps未設定の旧カードは、従来の最終maxPerVisit制限のまま。slotCount未設定の旧カードは、特典の必要個数の最大値をマス数として返す。

## 司令塔の次の作業

1. E-9の既存の型エラーを画面側で直し、E-4・E-7・E-8・E-9・E-10の画面を上記の口・型・API関数へ接続する。
2. 公開PRを作る前にmigration番号を再確認し、番号別承認を得る。605は未適用。
3. PRの実番号を反映履歴のファイル名と行へ入れ、統合後に検証環境へ反映する。

## 検証結果

- Worker全体：860ファイル、9,963件合格・30件スキップ。DB：2,123件、共有型：252件、管理画面のAPI関数：111件合格。
- 自分除外・手動送信限定・媒体通知オフ・下書きの版・共通情報の空欄・PINロック・写真の所有者・倍率停止・写真の非公開の9箇所を一つずつ意図的に壊し、試験が落ちることを確認して復元した。
- Worker・DB・共有型・LIFFの型検査、Worker・LIFFのビルド、差分の空白検査は合格。
- 管理画面の型検査・ビルドは `apps/web/src/v8/restaurant/dashboard/summarize.ts:107,110,111` の既存エラーで停止。E-9が `string | null` のslotIdを文字列キーとして扱い、itemsの推論もneverになる。取り込んだHEADにも同じ実装・共有型があり、今回その2ファイルは変更していない。画面の変更は禁止されているため司令塔へ引き継ぐ。閉鎖作業にはslotIdがnullのものが実際にあるので、共有型をstringに狭めない。
- D1・本番・配備・push・PRは実施していない。migration605は未適用。
