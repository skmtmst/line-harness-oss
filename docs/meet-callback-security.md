# Meet完了コールバックの署名

`POST /api/meet-callback` は公開URLですが、共有秘密鍵による署名が必須です。

- Worker Secret: `MEET_CALLBACK_SECRET`
- `X-Nen-Timestamp`: Unix秒（現在時刻との差が5分以内）
- `X-Nen-Signature`: `HMAC-SHA256(secret, "<timestamp>.<raw JSON body>")` の64文字hex
- 同じ `session_id` は1回だけ処理されます。内容を変えた再送は409です。

共有秘密鍵はコードやGitへ保存せず、Meet HarnessとCloudflare Workerへ同じ値をSecretとして設定してください。
