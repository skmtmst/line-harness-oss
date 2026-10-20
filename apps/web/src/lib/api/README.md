> 文書：Webの通信｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# Webの通信

`../api.ts` は公開互換口です。従来のexport名・apiの各キー・型を保ちます。

- `types/`：機能ごとの純型。実行時のAPIや公開互換口を読み込みません。
- `transport/`：CSRF、セッションの合図、安全なエラー、JSON/Blob/CSV、同時読取の共有。
- `features/`：管理画面の機能ごとの通信。`index.ts` が従来の順番で組み立てます。
- `booking.ts`・`events.ts`・`webinars.ts`・`booking-sync.ts`：独立した既存のクライアント。

分割した内部の機能クライアントと新しい呼び出し側は `./transport` を直接読みます。公開互換口を内部から読み直す循環を作らず、ApiErrorと通信の状態を一つに保ちます。既存の外側のクライアントと画面は公開互換口を継続でき、import変更は不要です。Webのimportに `.js` は付けません。

署名付きアップロードは指定ヘッダーと `credentials: omit` を保持します。認証前の操作、更新エンジン、結果不明の扱いを通常のJSON通信へ一括変換しません。通信層は更新要求を自動再送しません。

`api-booking-advanced.ts` が予約の追加契約、`api-styles.ts` がスタイルの契約です。`api-gap-draft`・`api-gap2-pending`・`api-style-setup` は画面移行用の互換口です。仮名を理由に未実装の応答を作りません。模擬支払いの `simulation: true` / `sent: false` は `api-booking-payment-types.ts` が共有します。

ソースを読む既存検査と模擬APIは `apps/web/scripts/test-api-source.mjs` を通して公開口から分割先を読みます。模擬APIの指紋にも分割先を含め、古い通信契約での撮影を防ぎます。検査の期待値・下限は保ちます。
