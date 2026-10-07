# 受信箱の添付API（2026-10-08）

司令塔の「受信箱で動画・ファイルを送る」依頼に対して実装した口の説明。画面の変更は含まない。

| 用途 | 口 |
|---|---|
| 画像・ファイルを入れる | `POST /api/chats/:id/attachments/upload` |
| MP4をR2へ直接入れる準備 | `POST /api/chats/:id/attachments/upload-sessions` |
| MP4のアップロード結果を確定 | `POST /api/chats/:id/attachments/upload-sessions/:sessionId/complete` |
| LINEからの取得・ファイルのダウンロード | `GET /images/chat-attachments/:attachmentId` |
| 決まった動画プレビュー | `GET /images/chat-attachments/video-preview.png` |
| すぐ送る（拡張） | `POST /api/chats/:id/send` |
| 予約する・変更する（拡張） | `POST /api/chats/:id/schedule`、`PATCH /api/chats/:id/scheduled/:scheduleId` |

`:id`は既存の受信箱と同じ会話IDまたは友だちID。アップロードは受信箱の変更権限が必要で、会話・LINEアカウント・統括の範囲を確認する。ダウンロードは推測困難なUUID v4が鍵になる公開口。

## 形式と上限

- 動画：MP4、200 × 1024 × 1024バイトまで。API-6と同じ署名URL生成・既存のアップロード予約表・ETagとサイズと所属の照合・完了のCASを使う。Worker経由の大きいリクエストを避け、R2へPUTする。新しい表・migrationは不要。
- 画像：JPEG/PNG、10 × 1024 × 1024バイトまで。動画プレビューに選ぶ画像は1 × 1024 × 1024バイトまで。
- ファイル：PDF、DOCX、XLSX、PPTX、ZIP、10 × 1024 × 1024バイトまで。アップロード時から30日でリンクが使えなくなる。
- ファイル名・宣言形式・実際の内容を照合する。画像・PDF・MP4は既存の内蔵検査を利用。Office/ZIPは展開せず中央ディレクトリを検査し、Office固有の内容名を確認する。暗号化・分割・ZIP64・マクロ・実行ファイル名・親フォルダ参照を拒否する。ZIPは最大1000項目、展開後の申告合計100MBまで。ウイルス検査や圧縮内容の完全な解析ではない。

LINEの上限の確認：[公式の動画メッセージ仕様](https://developers.line.biz/en/reference/messaging-api/#video-message)。先頭のコマは生成しない。プレビュー未指定なら、Workerに内蔵した320×180の再生マークのPNGを使う。画像を選んだ場合は同じ会話に入れたJPEG/PNGだけを使う。

## 呼び方

画像・ファイルのアップロードは本文に元のバイト、`Content-Type`に形式、`X-Filename`にUTF-8でpercent-encodeしたファイル名を入れる。サイズは実際に読み取ったバイト数でも確認する。

動画の準備はJSONの`{ filename, mimeType: "video/mp4", sizeBytes }`を渡す。応答の`uploadUrl`に`requiredHeaders`を付けてPUTし、応答のETagをJSONの`{ etag }`として完了口へ渡す。準備の署名URLは15分。R2のCORSは既存API-6と同じ設定（PUTと署名ヘッダーを許可し、ETagをブラウザーへ公開）が必要。失敗・ETag欠落では完了やLINE送信へ進めない。

確定した添付は`{ id, key, url, filename, mimeType, size, kind, expiresAt }`を返す。アップロードしただけではLINEに送らない。`api.chats.attachments.upload(id, file)`は上の手順をまとめる。

送信・予約のJSONには`messageType`と文字列の`content`を入れる。`content`の中身は次のJSONを文字列にしたもの。

```ts
// 動画。previewImageUrlは省略すると決まった画像になる。
JSON.stringify({ originalContentUrl: uploadedVideo.url })
// 自分で入れたプレビューを使う場合。
JSON.stringify({ originalContentUrl: uploadedVideo.url, previewImageUrl: uploadedImage.url })
// ファイル。送るURL・ファイル名・大きさはサーバーの保存情報を使う。
JSON.stringify({ attachmentId: uploadedFile.id })
// 画像。既存の形式をそのまま使える。
JSON.stringify({ originalContentUrl: imageUrl, previewImageUrl: previewUrl })
```

画像・動画はLINEの`image`・`video`、ファイルはファイル名・大きさ・［URL］・日本時間の期限を含む`text`として届く。履歴は元の種別（fileを含む）と保存情報を残す。

担当者の送信は既存の受信箱と同じ直接LINE SDK呼び出しと`source=manual`の履歴。LINE Harness Proxyは経由しないため、その専用の`X-Line-Harness-Source`ヘッダーは追加しない。Proxy経由の担当者返信には既存規則どおり`manual`が必要。cronの予約送信は`source=scheduled`で、manualヘッダーを付けない。

## 期限・予約・二重送信

ファイルの原本は`private/`の下に置き、通常の`/images/*`からは取り出せない。公開URLはファイル名・友だちID・LINEアカウントIDを含まない。期限後は410、成功時も期限後も`Cache-Control: private, no-store`。期限は取得を止めるもので、原本を自動削除する処理は含まない。

画像・動画・ファイルは予約できる。予約作成・日時変更・添付変更・送信直前で検証する。ファイルの期限以降の予約は400、予約後に期限切れ・削除・所属変更になればLINEを呼ばずfailedにする。予約の種別は作成後に変えず、変更するcontentも保存済みの種別で検証する。送信中以降は既存どおり409。

送信は既存の返信lease・冪等キー・LINE Retry-Keyを維持する。予約も既存のclaim・lease・Retry-Keyを使い、送達不明の自動再送はしない。同じ予約キーを別の内容へ使った場合は409にする。

## 司令塔への引き継ぎ

- push・PR・DB適用・配備は作業役では実施しない。
- PR採番後、`docs/release-log/unreleased/<PR番号>-kenta-inbox-attachments.md`を作り、次の1行を追加する（番号は推測しない）。
  `- 受信箱から動画とファイルを送れるようにし、画像・動画・ファイルの予約送信にも対応した @kenta #<PR番号> <日本時間 YYYY-MM-DD HH:MM>`
- 画面側は左下のクリップの選択から`api.chats.attachments.upload`を呼び、返された添付を`send`または`schedule`へ渡す。画面・Pencilの実装と照合は司令塔の担当。

## 検証結果

- 検証の基準：`origin/codex/development`の`cc993003f025b203ef4f82dca706d40c21c3e7ae`を専用ブランチへmergeしてから再実行。
- Worker：受信箱・予約・API-6動画・Proxy・認証・権限・OpenAPIの20ファイル、322件合格（今回の追加31件）。
- Web：添付API関数と既存API関数の2ファイル、119件合格（今回の追加8件）。合計441件、追加39件。
- shared・line-sdk・db・update-engineのビルド、Workerの型検査、Webの型検査、Worker/Webのビルド、差分検査を確認。既存のlint・バンドルサイズなどの警告はあるが、終了コードは0。
- 上限の拒否・会話の照合・期限の拒否・videoの種別をそれぞれ意図的に壊す4通りで、対応する試験が失敗することを確認し、元へ戻して全対象を再実行した。
- ローカルSQLiteとR2の代わりの保存先で検証。実際のLINE送信・R2アップロード、D1適用、配備はしていない。
