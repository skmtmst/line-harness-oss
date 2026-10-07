# E-11 席予約と会話検索のAPI引き継ぎ（2026-10-07）

- 司令塔Claudeの依頼6点を `codex/kenta-v8-api-9` で実装し、コミットまで実施。
- テスト前に取得・取り込んだ本線：`51997b340b32a64dbcdd563fa771d6f5557fbef7`。
- 席予約：`6d305aa24a`。会話検索：`bb89ffa632`。
- doctor合格。親・LINEの開始時の作業ツリーはクリーン。画面・docs/brain・docs/v6-requirementsは変更していない。

## 画面から使う契約

| 項目 | APIと渡す値・読む値 |
|---|---|
| 店舗の予約リンク | POST `/api/restaurant-test/reservation-link`。店舗自身の有効なLINEアカウントのLIFF IDを使い、`https://liff.line.me/<liffId>/restaurant/reserve/<token>` を返す。共通のLIFF_URLへは依存しない。未設定・停止・保管済みアカウントは503 |
| ご要望と電話 | 仮押さえ・確定の本文に `note`（任意、Unicodeの文字数で200文字まで）と `customerPhone`（任意、50文字まで、数字・空白・括弧・ハイフン・+）を渡す。確定で省略すると仮押さえの値を維持し、null・空欄なら消す。予約履歴の返事にも同じ名前で返す。台帳の既存の `note`・`customer_phone` に保存する |
| 空きがない理由 | GET `/api/liff/restaurant/availability` の `slots[].unavailableReason`、日全体に空きがなければ `unavailableReason`。値は `temporary_closed`（臨時休業）・`private_event`（貸切）・`regular_closed`（定休）・`full`（満席・受付終了）。空きがある場合は理由の項目を省く。内部の休業メモは返さない |
| 席の種類 | 空きの `slots[].seatTypes` は空いている候補卓の種類の配列。確定・仮押さえ・履歴の `seatType` は割り当てた卓の種類（卓がなければnull）。卓の設定から読む |
| 遅刻の案内 | GET/PUT `/api/restaurant-test/opening-hours` の `lateArrivalPolicy: { cancelAfterMinutes, message }`。分数は1〜1440、文言は1000文字まで。保存時に省略すれば維持、nullで解除。版・店舗・編集権限を検査。設定があればLIFFの空きに `lateArrivalPolicy` を返し、未設定なら項目ごと省く |
| 会話の検索 | `/api/chats/:friendId/messages/search` の引数・返事の形は維持。NFKCで正規化した本文をDBに保持し、検索・全件数・ページ分割・前後の1件はDBで処理。初回だけ既存の未索引本文を500件ずつ正規化し、以後は新規・変更分だけ処理する。本文の編集・送信取消・テスト送信への切替はDBトリガーで索引を無効にする |

共有型・LIFFの `restaurantBookingApi`・管理画面の `restaurantTestApi`・公開OpenAPIを更新済み。LIFFの確定は既存の `(id, expectedVersion)` に加え、第3引数で任意欄を渡せる。

## 検証

- Worker全体：861ファイル、9,975件合格・30件スキップ。最後の休業理由の調整後は予約・検索の23件を再実行して合格。
- DB全体：2,125件、共有型：252件、管理画面のAPI関数：112件、LIFFのAPI関数：4件合格。DBの新しい試験を内容別に分けた後も2件合格。
- 店舗LIFF IDの欠落・要望保存抜け・休業理由の誤り・席種欠落・遅刻案内欠落・会話本文の全件読込を一つずつ意図的に壊し、6箇所すべて試験が落ちることを確認して復元。
- 1万件の会話について、正しい全件数・ページ送り・前後の会話を確認。繰り返し検索では正規化更新がなく、未索引だけの照会とDBで件数を絞る検索になることを検証。
- Worker・DB・LIFFの型検査、Worker・LIFFのビルド、bootstrap一致、差分の空白検査は合格。
- 管理画面全体の型検査・ビルドは、既存の `apps/web/src/v8/restaurant/dashboard/summarize.ts:107,110,111` の型エラーで停止。`slotId` がnullの場合とitemsの型を画面担当で直す。今回この画面と原因の共有型は変更していない。

## 司令塔の次の作業

1. E-11の画面を上記の項目に接続し、既存の管理画面の型エラーを修正する。
2. migration `606_restaurant_liff_details.sql`・`607_conversation_search_content.sql` の番号別承認を得る。作成時に最新本線と公開PRの追加ファイルを全ページ確認し、本線589・公開PR604・手元605の次の未使用番号を選んだ。両方とも未適用の草稿で、共有前にも番号を再確認する。
3. PR採番後、今回の反映履歴2ファイルの名前と本文に実際のPR番号を入れて統合する。
4. 検証環境でDB更新・コード反映と画面の接続を確認する。既存会話の初回索引作成には処理時間が必要。D1上の実際の応答時間は未測定。

push・PR・stash・rebase・force・本番操作・D1操作・配備は実施していない。
