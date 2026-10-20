> 文書：統括API｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 統括API

型は `packages/shared`、呼び出しは `apps/web/src/lib/hq-templates-api.ts`・`hq-broadcasts-api.ts`・`api-hq-deliveries.ts` にあります。口の一覧はWorkerのOpenAPIで確認します。

## アカウントとひな形

LINEの登録・親・担当・既存LIFFの確認は [LINE登録](../line-account-register.md) に従います。資格情報を返事へ出しません。接続成功だけで提供元の一致と判断しません。取込は永続状態・ロックで進め、画面は状態を読みます。検証環境では定期処理が有効とは限りません。

画像ライブラリは `GET /api/hq/banners/images` の `q,delivered,favorite,preset,shape,before,limit` で絞ります。全条件をページ分割前に適用し、全件・お気に入り・配布済み・未配布の件数も同条件です。同じ日時の画像をページ間で落としません。

| 口 | 使い方 |
| --- | --- |
| `/api/line-account-folders` | GET/POST/PATCH/DELETE。名前・色・表示順、担当範囲の件数を扱う |
| `PUT /api/line-accounts/:id/folder` | `folderId`。nullで未分類。所属は1つ。削除してもアカウントは残る |
| `GET /api/line-accounts` | `folderId`、`__none__`で未分類。返事にも所属フォルダを含む |
| `/api/hq/templates` | 作成・変更・確認・配布・結果を共用。`kind`で種類を絞る |
| `/api/hq/templates/kind-counts` | メッセージ・カルーセル・リッチメッセージ・質問・クーポン・リサーチの全6種類の件数 |
| `/api/hq/templates/attribute-kind-counts` | タグの種類別件数。友だち情報欄と対応マークの配布は未対応 |
| `/api/hq/templates/folders`・`/:id/duplicate` | 分類と複製。分類削除は未分類へ戻す。複製は別IDで原本を保つ |
| `/:id/versions`・`/versions/compare?from=&to=`・`/versions/:version/restore` | 版の一覧・比較・復元。復元も新しい版で保存し、`expectedRevision`を渡す |
| `/:id/received-versions` | 店ごとの最新成功配布版と現在版との差 |
| `/api/hq/templates/media?purpose=rich_message&filename=…` | POSTで画像を登録。240/300/460/700/1040の5サイズを作り、配布先へコピーする |

変更は統括全体を扱えるowner/adminだけです。フォルダとアカウントの閲覧は担当範囲に限ります。作成・複製は `requestId`、変更は読んだ版を渡し、別統括・古い版・曖昧な参照を拒みます。

アカウントの所属はフォルダ1つが正です。従来のタグ辞書・IDと旧APIは互換で維持し、複数タグの旧データは表示順・名前・IDの順で所属を選びます。新フォルダへ移すと旧タグの所属も合わせます。

ひな形の保存は名前と定義を一度に送ります。カードは本文・画像・最大3ボタンを定義へまとめます。フォーム・シナリオの候補は `/api/hq/templates/message-references` で読み、同名の配布先を一意に解決します。無い・複数ある・所属やLIFFが変わった時は再確認し、勝手に関連物を複製しません。

カルーセルの店側の保存名は `card_message`。質問・カード等の対応済み参照は店のIDへ直します。タグ・情報欄・対応マークなど未対応の店固有IDや、使用後の共通アクションを統括から持ち回りません。

自動応答・追加時配信・リマインダは `HqDeliveryTemplateInput` を使います。定義は `{schemaVersion:1,settings,references:[]}`。リマインダの通には `stableStepId` が必要です。ひな形名と店に届く名前は別に保存します。

配布はpreflightの `allowedModes` から作成・上書き・別名を選びます。上書きは未使用の下書きだけ、店には下書きで届きます。参照の `operation:reuse,mode:overwrite` は参照先を書き換えません。公開・使用開始・版の変更は競合として止めます。同じ配布キーで増やしません。統括の新版を作っても店の配布済み版は変わりません。店舗別の本文上書きはテキストひな形だけで、preflightの確認済み内容を固定します。

画像の要約は枚数・選択肢数・期限などです。本文と画像URLは出しません。素材の全サイズの使用参照を保持し、使用中画像は消せません。未対応の一括画像置換はひな形編集から直します。

## 一括配信

`/api/hq/broadcasts` は統括全体のowner/admin専用です。店側から子配信を変更・停止・再送できません。

| 口 | 入力・返事 |
| --- | --- |
| GET/POST、GET/PATCH `/:id` | `requestId,title,messageType,messageContent,accountIds,accountTagIds,excludedAccountIds,audience,scheduledAt`。吹き出し・altText・フォルダ・社内メモ・計測も保存。変更には`expectedVersion` |
| `/:id/preflight`・`/:id/exclusions` | 人数・残枠・接続・停止理由を店ごとに確認。除外変更は`accountIds,expectedVersion` |
| `/:id/send`・`/:id/stop`・`/:id/cancel`・`/:id/targets/:accountId/retry` | 読んだ版を渡す。送信・再送には`X-Confirm-Irreversible: broadcast-send` |
| `/approvals/candidates`・`/:id/approval`・`/:id/approval-request`・`approve`・`reject`・`approval-cancel` | 別人承認と本人確認。人数変更は再承認。1人運用は送信時の`confirmedRecipientCount`が必要 |
| `/:id/test-send` | `accountId`。その店のテスト宛先へ全吹き出しを送る |
| `/:id/export.csv`・`/:id/targets/:accountId/recipients`・`/:id/activity` | 宛先台帳と操作。詳細には店舗別の送信・開封・クリック・反応を返す |

作成時に店舗と対象を固定し、後から分類に追加された店は含めません。同名のタグ・シナリオ・保存条件を店へ対応させ、無い・複数・未対応の条件は送信前に止めます。保存条件は `segment_v1`。残枠が分からない時も止めます。

`{{account.name}}` は送信店舗名、`{{var.*}}` は店の共通情報です。`{{var.store_phone}}`・`{{var.reservation_url}}`（旧表記も受理）が空なら送信前確認で止めます。`data.input` から編集を復元し、`failureReasons` の理由・件数・再送可否を表示します。

一時失敗と停止前の未送信だけ再送できます。成功・送達不明・全店取消後は再送しません。送信済みのLINEは取り消せません。予約の停止・取消は下書きへ戻します。操作と実行・対象の記録は子配信が期限削除された後も保持します。

今月の通数は日本時間で、テスト送信と重複を除きます。計測未取得、資産とログの対応が無い通数、未対応の件数はnullと理由を返し、0にしません。反応人数は配信後に受信した送信先の人数で、返信の原因は断定しません。
