> 文書：記録の JSON を開いて写す部品のコード案内｜区分：今の説明｜最終確認：2026-10-26（日本時間）

# 記録の JSON を開いて写す

送信・受信・実行の記録を、伏せた後の JSON で開いて写す部品です。画面の入口はありません。各記録の画面が [index.ts](index.ts) の `LogRecordJson` を読みます。

## 外に見せる名前（index.ts）

- `LogRecordJson`：［〇〇の JSON を開く］で開き、字下げした JSON と［JSON をコピー］を出す。閉じている間は整形しない。長い記録は先頭だけを出し、写すのは全文。
- `redactLogRecord`・`formatLogRecord`：伏せ方と整形（[redact.ts](redact.ts)）。

## 伏せ方と権限

- 渡す値は、各画面がいま見せている範囲の記録だけにします（例：友だちの名前・ID、送る文面は渡さない）。
- 部品の中でも、秘密値（署名・トークン・Authorization・合言葉・鍵など）と個人情報（メール・電話・LINE の利用者 ID・表示名など）の名前の項目、Bearer の鍵・JWT の形の値、URL の問い合わせ部分を必ず伏せます。
- 開いて読むのは閲覧のみの人もできます。写す操作は、各画面が渡す `canCopy` が true の人にだけ出します（今の記録のコピーと同じ人）。

## 使っている画面

- 外部連携のやり取りの記録：中身の窓の［技術的な記録を開く］の下（[interactions.tsx](../webhooks/interactions.tsx)）。
- 友だち追加時の配信の実行の詳細：行ったことの下（[detail.tsx](../friend-add-runs/detail.tsx)）。

API・保存処理はありません。描画は共通の `CodeBlock`・`CopyTextButton`・`Button` と [CSS Modules](log-record-json.module.css) を使います。見た目の決まりは [V8](../../../../../docs/v8-design-rules.md) の §6.32（コードの箱）と §6.11（コピー）を読みます。

試験：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/log-record`。
